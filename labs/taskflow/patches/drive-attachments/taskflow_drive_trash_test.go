package storage

import (
	"context"
	"errors"
	"testing"
)

type driveTrashTest struct {
	*driveIndexTest
	key                     string
	queued, done, surviving bool
}

func (i *driveTrashTest) PendingTrash(context.Context, int) ([]string, error) {
	if i.queued && !i.done {
		return []string{i.key}, nil
	}
	return nil, nil
}
func (i *driveTrashTest) TrashBinding(ctx context.Context, key string) (TaskFlowDriveBinding, error) {
	if !i.queued || i.done || i.surviving || key != i.key {
		return TaskFlowDriveBinding{}, errors.New("not eligible")
	}
	return i.Lookup(ctx, key)
}
func (i *driveTrashTest) MarkTrashed(context.Context, string) error { i.done = true; return nil }
func TestTaskFlowDriveTransactionalTrash(t *testing.T) {
	for _, mode := range []string{"success", "outage", "surviving", "unapproved", "shared"} {
		t.Run(mode, func(t *testing.T) {
			s, f, original := fixtureDrive(t)
			ctx := context.Background()
			key := "workspaces/ws/id"
			if _, e := s.Upload(ctx, key, []byte("original"), "x", "x"); e != nil {
				t.Fatal(e)
			}
			q := &driveTrashTest{driveIndexTest: original, key: key, queued: true}
			s.index = q
			s.trashEnabled = true
			switch mode {
			case "outage":
				f.status = 503
			case "surviving":
				q.surviving = true
			case "unapproved":
				s.trashEnabled = false
			case "shared":
				f.fileShared = true
			}
			e := s.DeleteObject(ctx, key)
			if mode == "success" {
				if e != nil || !f.trashed || !q.done {
					t.Fatal("confirmed trash not recorded", e)
				}
			} else {
				if e == nil || f.trashed || q.done {
					t.Fatal("unsafe trash/success")
				}
			}
			if mode == "outage" {
				f.status = 0
				if e = s.tryTrash(ctx, key); e != nil || !f.trashed || !q.done {
					t.Fatal("durable pending retry failed", e)
				}
			}
		})
	}
}
