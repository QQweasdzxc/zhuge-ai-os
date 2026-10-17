package handler

import (
	"strings"
	"testing"
)

func TestTaskflowCodexCallbackMarkersAreStrictAndBounded(t *testing.T) {
	thread := "01a13ee3-8cb4-7e81-9cac-b26a6cebf570"
	var ack codexAckMarker
	validAck := `<!-- ZHUGE_CODEX_ACK_V1 {"dispatch_id":"01a13ee3-8cb4-7e81-9cac-b26a6cebf571","checkpoint_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"accepted","thread_id":"` + thread + `"} -->`
	if !codexMarker("accepted\n"+validAck, "ACK", &ack) || ack.ThreadID == nil || *ack.ThreadID != thread {
		t.Fatal("valid Codex ACK marker was not parsed")
	}
	var invalid codexAckMarker
	if codexMarker(validAck+"\n"+validAck, "ACK", &invalid) {
		t.Fatal("duplicate ACK marker was accepted")
	}
	if codexMarker(strings.Replace(validAck, `"status":"accepted"`, `"status":"accepted","untrusted":true`, 1), "ACK", &invalid) {
		t.Fatal("unknown marker field was accepted")
	}
	var result codexResultMarker
	validResult := `<!-- ZHUGE_CODEX_RESULT_V1 {"dispatch_id":"01a13ee3-8cb4-7e81-9cac-b26a6cebf571","thread_id":"` + thread + `","state":"review_pending","commit_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","summary":"tests passed"} -->`
	if !codexMarker(validResult, "RESULT", &result) || result.State != "review_pending" || result.Summary != "tests passed" {
		t.Fatal("valid result marker was not parsed")
	}
	if count := codexMarkerCount(validAck + "\n" + validResult); count != 2 {
		t.Fatalf("mixed protocol markers count = %d, want 2", count)
	}
	if count := codexMarkerCount(validAck); count != 1 {
		t.Fatalf("single protocol marker count = %d, want 1", count)
	}
	if codexMarker("<!-- ZHUGE_CODEX_RESULT_V1 {\"summary\":\""+strings.Repeat("x", 128*1024)+"\"} -->", "RESULT", &result) {
		t.Fatal("oversized result was accepted")
	}
}
