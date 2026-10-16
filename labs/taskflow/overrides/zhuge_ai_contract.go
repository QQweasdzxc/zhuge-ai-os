package taskflowcontract

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

var (
	idempotencyKeyPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
	taskIdentifierPattern = regexp.MustCompile(`^[A-Z0-9]{1,10}-[1-9][0-9]*$`)
	githubDeliveryPattern = regexp.MustCompile(`(?i)^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
	githubHeadSHAPattern  = regexp.MustCompile(`^[a-f0-9]{40}$`)
)

func ValidApproval(expectedRevision, currentRevision int64, idempotencyKey string) bool {
	return expectedRevision > 0 && expectedRevision == currentRevision && idempotencyKeyPattern.MatchString(idempotencyKey)
}

func StatusEligible(status string) bool {
	switch status {
	case "backlog", "todo", "in_progress", "in_review", "unstarted", "started":
		return true
	default:
		return false
	}
}

func ValidEngineer(engineer string) bool {
	return engineer == "co" || engineer == "gem"
}

func ClosingMarker(identifier string) string {
	if !taskIdentifierPattern.MatchString(identifier) {
		return ""
	}
	return "Closes " + identifier
}

func ValidGitHubDeliveryID(value string) bool { return githubDeliveryPattern.MatchString(value) }

func ValidGitHubHeadSHA(value string) bool { return githubHeadSHAPattern.MatchString(value) }

func PayloadSHA256(body []byte) string {
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func DeliveryPayloadMatches(recordedDigest string, body []byte) bool {
	return recordedDigest == PayloadSHA256(body)
}
