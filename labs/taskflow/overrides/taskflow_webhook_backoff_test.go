package handler

import (
	"context"
	"testing"
	"time"
)

func TestTaskFlowWebhookBackoffIsBoundedAndJittered(t *testing.T) {
	tests := []struct {
		name   string
		jitter float64
		want   time.Duration
	}{
		{name: "lower jitter bound", jitter: 0, want: 1600 * time.Millisecond},
		{name: "midpoint", jitter: 0.5, want: 2 * time.Second},
		{name: "upper jitter bound", jitter: 1, want: 2400 * time.Millisecond},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := taskFlowWebhookNextPollDelayWithJitter(time.Second, tt.jitter); got != tt.want {
				t.Fatalf("next delay = %s, want %s", got, tt.want)
			}
		})
	}
	if got := taskFlowWebhookNextPollDelayWithJitter(30*time.Second, 1); got != 30*time.Second {
		t.Fatalf("maximum delay = %s, want 30s", got)
	}
	if got := taskFlowWebhookNextPollDelayWithJitter(-time.Second, 0); got < taskFlowWebhookIdleMinDelay {
		t.Fatalf("delay fell below minimum: %s", got)
	}
}

func TestTaskFlowWebhookIdlePollRateFallsAfterBackoff(t *testing.T) {
	// The previous fixed 1s ticker made four workers issue up to 4 idle claims
	// per second. With a 30s capped interval, steady-state idle claims are at
	// most 4/30 per second; Notify still interrupts the timer immediately.
	if got, want := float64(webhookWorkerConcurrency)/float64(taskFlowWebhookIdleMaxDelay.Seconds()), 4.0/30.0; got != want {
		t.Fatalf("steady-state idle query rate = %v/s, want %v/s", got, want)
	}
}

func TestTaskFlowWebhookWakeSignalAndCancellationRemainImmediate(t *testing.T) {
	notify := make(chan struct{}, 1)
	notify <- struct{}{}
	if got := waitForTaskFlowWebhookWake(context.Background(), notify, time.Hour); got != taskFlowWebhookNotified {
		t.Fatalf("wake reason = %v, want immediate notification", got)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := waitForTaskFlowWebhookWake(ctx, make(chan struct{}), time.Hour); got != taskFlowWebhookCancelled {
		t.Fatalf("wake reason = %v, want cancellation", got)
	}
}
