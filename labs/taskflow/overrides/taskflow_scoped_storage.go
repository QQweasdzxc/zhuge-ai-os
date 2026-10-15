package storage

import (
	"context"
	"errors"
	"io"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
)

const taskFlowSupabaseKeyPrefix = "@taskflow-supabase:"
const taskFlowLocalKeyPrefix = "@taskflow-local:"

// TaskFlowScopedStorage directs only native workspace attachment objects to
// the private Supabase bucket. Existing non-attachment storage paths (avatars,
// source-context copies, and integration media) continue through the existing
// local backend and are not silently moved or reinterpreted.
//
// There is deliberately no fallback from a recognized attachment key to the
// local backend. A missing/expired user JWT or unavailable Supabase bucket
// fails closed rather than writing a transient attachment to Render disk.
type TaskFlowScopedStorage struct {
	attachments *TaskFlowSupabaseStorage
	legacy      Storage
}

func NewTaskFlowScopedStorage(attachments *TaskFlowSupabaseStorage, legacy Storage) (*TaskFlowScopedStorage, error) {
	if attachments == nil || legacy == nil {
		return nil, errors.New("TaskFlow scoped Storage requires both the private attachment adapter and existing non-attachment Storage")
	}
	return &TaskFlowScopedStorage{attachments: attachments, legacy: legacy}, nil
}

func isTaskFlowWorkspaceAttachmentKey(key string) bool {
	return isTaskFlowAttachmentKeyUnder("workspaces", key)
}

func isTaskFlowUserAttachmentKey(key string) bool {
	return isTaskFlowAttachmentKeyUnder("users", key)
}

func isTaskFlowAttachmentKeyUnder(scope string, key string) bool {
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(key), "/"), "/")
	if len(parts) != 3 || parts[0] != scope || parts[2] == "" {
		return false
	}
	scopeID, err := uuid.Parse(parts[1])
	if err != nil || scopeID.String() != strings.ToLower(parts[1]) {
		return false
	}
	filename := path.Base(parts[2])
	attachmentID, err := uuid.Parse(strings.TrimSuffix(filename, path.Ext(filename)))
	if err != nil || attachmentID.Version() != 7 || path.Ext(filename) == "" {
		return false
	}
	return true
}

func markedTaskFlowSupabaseKey(key string) (string, bool) {
	if strings.HasPrefix(key, taskFlowSupabaseKeyPrefix) {
		return strings.TrimPrefix(key, taskFlowSupabaseKeyPrefix), true
	}
	if isTaskFlowWorkspaceAttachmentKey(key) || isTaskFlowUserAttachmentKey(key) {
		return key, true
	}
	return "", false
}

func taskFlowLegacyKey(key string) (string, bool) {
	if strings.HasPrefix(key, taskFlowLocalKeyPrefix) {
		return strings.TrimPrefix(key, taskFlowLocalKeyPrefix), true
	}
	return "", false
}

func (s *TaskFlowScopedStorage) Upload(ctx context.Context, key string, data []byte, contentType, filename string) (string, error) {
	if isTaskFlowWorkspaceAttachmentKey(key) || isTaskFlowUserAttachmentKey(key) {
		return s.attachments.Upload(ctx, key, data, contentType, filename)
	}
	return s.legacy.Upload(ctx, key, data, contentType, filename)
}

func (s *TaskFlowScopedStorage) UploadStream(ctx context.Context, key string, data io.Reader, sizeBytes int64, contentType, filename string) (string, error) {
	if isTaskFlowWorkspaceAttachmentKey(key) || isTaskFlowUserAttachmentKey(key) {
		if sizeBytes < 0 || sizeBytes > TaskFlowSupabaseAttachmentMaxBytes {
			return "", &TaskFlowSupabaseStorageError{Status: 413, Cause: "object exceeds TaskFlow bucket limit"}
		}
		limited := io.LimitReader(data, TaskFlowSupabaseAttachmentMaxBytes+1)
		bytes, err := io.ReadAll(limited)
		if err != nil {
			return "", err
		}
		if int64(len(bytes)) != sizeBytes || int64(len(bytes)) > TaskFlowSupabaseAttachmentMaxBytes {
			return "", &TaskFlowSupabaseStorageError{Status: 413, Cause: "stream length is outside TaskFlow bucket limit"}
		}
		return s.attachments.Upload(ctx, key, bytes, contentType, filename)
	}
	if streamStore, ok := s.legacy.(interface {
		UploadStream(context.Context, string, io.Reader, int64, string, string) (string, error)
	}); ok {
		return streamStore.UploadStream(ctx, key, data, sizeBytes, contentType, filename)
	}
	if sizeBytes < 0 || sizeBytes > TaskFlowSupabaseAttachmentMaxBytes {
		return "", errors.New("non-attachment stream size is unsupported by the existing Storage backend")
	}
	bytes, err := io.ReadAll(io.LimitReader(data, sizeBytes+1))
	if err != nil {
		return "", err
	}
	if int64(len(bytes)) != sizeBytes {
		return "", errors.New("non-attachment stream length mismatch")
	}
	return s.legacy.Upload(ctx, key, bytes, contentType, filename)
}

func (s *TaskFlowScopedStorage) Delete(ctx context.Context, key string) {
	if storageKey, ok := taskFlowLegacyKey(key); ok {
		s.legacy.Delete(ctx, storageKey)
		return
	}
	if storageKey, ok := markedTaskFlowSupabaseKey(key); ok {
		s.attachments.Delete(ctx, storageKey)
		return
	}
	s.legacy.Delete(ctx, key)
}

func (s *TaskFlowScopedStorage) DeleteObject(ctx context.Context, key string) error {
	if storageKey, ok := taskFlowLegacyKey(key); ok {
		return s.legacy.DeleteObject(ctx, storageKey)
	}
	if storageKey, ok := markedTaskFlowSupabaseKey(key); ok {
		return s.attachments.DeleteObject(ctx, storageKey)
	}
	return s.legacy.DeleteObject(ctx, key)
}

func (s *TaskFlowScopedStorage) DeleteKeys(ctx context.Context, keys []string) {
	for _, key := range keys {
		s.Delete(ctx, key)
	}
}

func (s *TaskFlowScopedStorage) KeyFromURL(rawURL string) string {
	if key := s.attachments.KeyFromURL(rawURL); key != "" {
		return taskFlowSupabaseKeyPrefix + key
	}
	return taskFlowLocalKeyPrefix + s.legacy.KeyFromURL(rawURL)
}

func (s *TaskFlowScopedStorage) ObjectURL(key string) string {
	if storageKey, ok := taskFlowLegacyKey(key); ok {
		return s.legacy.ObjectURL(storageKey)
	}
	if storageKey, ok := markedTaskFlowSupabaseKey(key); ok {
		return s.attachments.ObjectURL(storageKey)
	}
	return s.legacy.ObjectURL(key)
}

// A mixed backend must never advertise a globally public CDN: attachments are
// private even when the legacy backend has a public base URL.
func (s *TaskFlowScopedStorage) CdnDomain() string { return "" }

func (s *TaskFlowScopedStorage) GetReader(ctx context.Context, key string) (io.ReadCloser, error) {
	if storageKey, ok := taskFlowLegacyKey(key); ok {
		return s.legacy.GetReader(ctx, storageKey)
	}
	if storageKey, ok := markedTaskFlowSupabaseKey(key); ok {
		return s.attachments.GetReader(ctx, storageKey)
	}
	return s.legacy.GetReader(ctx, key)
}

func (s *TaskFlowScopedStorage) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if storageKey, ok := taskFlowLegacyKey(key); ok {
		if presigner, ok := s.legacy.(Presigner); ok {
			return presigner.PresignGet(ctx, storageKey, ttl)
		}
		return "", errors.New("existing Storage backend does not support signed downloads")
	}
	if storageKey, ok := markedTaskFlowSupabaseKey(key); ok {
		return s.attachments.PresignGet(ctx, storageKey, ttl)
	}
	if presigner, ok := s.legacy.(Presigner); ok {
		return presigner.PresignGet(ctx, key, ttl)
	}
	return "", errors.New("existing Storage backend does not support signed downloads")
}

func (s *TaskFlowScopedStorage) PresignGetWithContentDisposition(ctx context.Context, key string, ttl time.Duration, disposition string) (string, error) {
	if storageKey, ok := taskFlowLegacyKey(key); ok {
		if presigner, ok := s.legacy.(DownloadPresigner); ok {
			return presigner.PresignGetWithContentDisposition(ctx, storageKey, ttl, disposition)
		}
		return "", errors.New("existing Storage backend does not support signed downloads")
	}
	if storageKey, ok := markedTaskFlowSupabaseKey(key); ok {
		return s.attachments.PresignGetWithContentDisposition(ctx, storageKey, ttl, disposition)
	}
	if presigner, ok := s.legacy.(DownloadPresigner); ok {
		return presigner.PresignGetWithContentDisposition(ctx, key, ttl, disposition)
	}
	return "", errors.New("existing Storage backend does not support signed downloads")
}
