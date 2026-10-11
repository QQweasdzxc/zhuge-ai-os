package handler

import (
	"context"
	"math/rand/v2"
	"time"
)

const (
	taskFlowWebhookIdleMinDelay = time.Second
	taskFlowWebhookIdleMaxDelay = 30 * time.Second
)

func taskFlowWebhookNextPollDelay(current time.Duration) time.Duration {
	return taskFlowWebhookNextPollDelayWithJitter(current, rand.Float64())
}

func taskFlowWebhookNextPollDelayWithJitter(current time.Duration, jitter float64) time.Duration {
	if current < taskFlowWebhookIdleMinDelay {
		current = taskFlowWebhookIdleMinDelay
	}
	if current >= taskFlowWebhookIdleMaxDelay {
		return taskFlowWebhookIdleMaxDelay
	}
	if jitter < 0 {
		jitter = 0
	} else if jitter > 1 {
		jitter = 1
	}

	next := current * 2
	if next > taskFlowWebhookIdleMaxDelay {
		next = taskFlowWebhookIdleMaxDelay
	}
	// ±20% jitter avoids synchronized idle/error polling across replicas.
	delay := time.Duration(float64(next) * (0.8 + jitter*0.4))
	if delay < taskFlowWebhookIdleMinDelay {
		return taskFlowWebhookIdleMinDelay
	}
	if delay > taskFlowWebhookIdleMaxDelay {
		return taskFlowWebhookIdleMaxDelay
	}
	return delay
}

type taskFlowWebhookWakeReason uint8

const (
	taskFlowWebhookTimerElapsed taskFlowWebhookWakeReason = iota
	taskFlowWebhookNotified
	taskFlowWebhookCancelled
)

func waitForTaskFlowWebhookWake(ctx context.Context, notify <-chan struct{}, delay time.Duration) taskFlowWebhookWakeReason {
	timer := time.NewTimer(delay)
	defer func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
	}()

	select {
	case <-ctx.Done():
		return taskFlowWebhookCancelled
	case <-notify:
		return taskFlowWebhookNotified
	case <-timer.C:
		return taskFlowWebhookTimerElapsed
	}
}
