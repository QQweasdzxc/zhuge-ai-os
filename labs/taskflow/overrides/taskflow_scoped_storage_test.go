package storage

import "testing"

func TestTaskFlowWorkspaceAttachmentKeysSelectPrivateBucket(t *testing.T) {
	valid := "workspaces/22222222-2222-4222-8222-222222222222/018f0000-0000-7000-8000-000000000001.pdf"
	if !isTaskFlowWorkspaceAttachmentKey(valid) {
		t.Fatal("native workspace attachment key was not routed to the private bucket")
	}
	for _, key := range []string{
		"users/22222222-2222-4222-8222-222222222222/018f0000-0000-7000-8000-000000000001.png",
		"workspaces/22222222-2222-4222-8222-222222222222/avatar.png",
		"workspaces/22222222-2222-4222-8222-222222222222/source-context/018f0000-0000-7000-8000-000000000001.pdf",
		"workspaces/22222222-2222-4222-8222-222222222222/018f0000-0000-4000-8000-000000000001.pdf",
		"workspaces/not-a-uuid/018f0000-0000-7000-8000-000000000001.pdf",
	} {
		if isTaskFlowWorkspaceAttachmentKey(key) {
			t.Errorf("non-attachment key was routed to Supabase: %q", key)
		}
	}
}

func TestTaskFlowUserAttachmentKeysSelectPrivateBucket(t *testing.T) {
	valid := "users/22222222-2222-4222-8222-222222222222/018f0000-0000-7000-8000-000000000001.png"
	if !isTaskFlowUserAttachmentKey(valid) {
		t.Fatal("native user attachment key was not routed to the private bucket")
	}
	if isTaskFlowUserAttachmentKey("users/22222222-2222-4222-8222-222222222222/avatar.png") {
		t.Fatal("user avatar path was incorrectly routed to the private attachment bucket")
	}
}

func TestTaskFlowSupabaseStorageKeyMarkerRoundTrips(t *testing.T) {
	key := "workspaces/22222222-2222-4222-8222-222222222222/018f0000-0000-7000-8000-000000000001.pdf"
	marked, ok := markedTaskFlowSupabaseKey(key)
	if !ok || marked != key {
		t.Fatalf("marked key = %q, %v", marked, ok)
	}
	marked, ok = markedTaskFlowSupabaseKey(taskFlowSupabaseKeyPrefix + key)
	if !ok || marked != key {
		t.Fatalf("persisted marker key = %q, %v", marked, ok)
	}
	if _, ok := markedTaskFlowSupabaseKey("workspaces/22222222-2222-4222-8222-222222222222/avatar.png"); ok {
		t.Fatal("avatar key was incorrectly routed into private attachment bucket")
	}
}

func TestTaskFlowLegacyURLKeyMarkerPreventsExistingLocalAttachmentRemap(t *testing.T) {
	legacy := "workspaces/22222222-2222-4222-8222-222222222222/018f0000-0000-7000-8000-000000000001.pdf"
	marked := taskFlowLocalKeyPrefix + legacy
	got, ok := taskFlowLegacyKey(marked)
	if !ok || got != legacy {
		t.Fatalf("legacy key marker = %q, %v", got, ok)
	}
	if _, ok := taskFlowLegacyKey(legacy); ok {
		t.Fatal("raw native attachment keys should select the new private bucket for new uploads")
	}
}
