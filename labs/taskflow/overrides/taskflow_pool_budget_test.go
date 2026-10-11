package main

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func setTaskFlowPoolBudget(t *testing.T, total, primary, replica, external, instances string) {
	t.Helper()
	t.Setenv(taskFlowSessionBudgetEnv, total)
	t.Setenv(taskFlowPrimaryBudgetEnv, primary)
	t.Setenv(taskFlowReplicaBudgetEnv, replica)
	t.Setenv(taskFlowExternalReserveEnv, external)
	t.Setenv(taskFlowAPIDeploymentCountEnv, instances)
	t.Setenv("DATABASE_MAX_CONNS", "")
	t.Setenv("DATABASE_MIN_CONNS", "")
	// A zero replica allocation is explicit: a read replica must remain
	// disabled until its own connection reservation is approved and measured.
	t.Setenv("DATABASE_REPLICA_MAX_CONNS", "")
	t.Setenv("DATABASE_REPLICA_MIN_CONNS", "")
}

func TestTaskFlowPoolBudgetRequiresExplicitLedger(t *testing.T) {
	t.Setenv(taskFlowSessionBudgetEnv, "")
	t.Setenv(taskFlowPrimaryBudgetEnv, "")
	t.Setenv(taskFlowReplicaBudgetEnv, "")
	t.Setenv(taskFlowExternalReserveEnv, "")
	t.Setenv(taskFlowAPIDeploymentCountEnv, "")
	err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 8, MinConns: 0}, primaryPoolSizing)
	if err == nil {
		t.Fatal("missing session ledger must fail closed")
	}
}

func TestTaskFlowPoolBudgetAcceptsConservativeSimulatedAllocation(t *testing.T) {
	setTaskFlowPoolBudget(t, "8", "4", "2", "2", "1")
	if err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 4, MinConns: 0}, primaryPoolSizing); err != nil {
		t.Fatalf("conservative simulated budget rejected: %v", err)
	}
	if err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 2, MinConns: 0}, replicaPoolSizing); err != nil {
		t.Fatalf("conservative simulated replica budget rejected: %v", err)
	}
}

func TestTaskFlowPoolBudgetAccountsForAllAPIInstances(t *testing.T) {
	setTaskFlowPoolBudget(t, "8", "6", "0", "2", "2")
	if err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 5, MinConns: 0}, primaryPoolSizing); err == nil {
		t.Fatal("per-instance pool max multiplied by API replicas must fit the allocation")
	}
	setTaskFlowPoolBudget(t, "8", "8", "0", "0", "2")
	if err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 4, MinConns: 0}, primaryPoolSizing); err != nil {
		t.Fatalf("exact multi-instance allocation rejected: %v", err)
	}
}

func TestTaskFlowPoolBudgetRejectsAllocationsAboveTotal(t *testing.T) {
	setTaskFlowPoolBudget(t, "8", "7", "1", "1", "1")
	if err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 4, MinConns: 0}, primaryPoolSizing); err == nil {
		t.Fatal("primary + replica reservations above the total must fail")
	}
}

func TestTaskFlowPoolBudgetRejectsImpossibleMinAndMax(t *testing.T) {
	setTaskFlowPoolBudget(t, "8", "8", "0", "0", "1")
	if err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 4, MinConns: 5}, primaryPoolSizing); err == nil {
		t.Fatal("min > max must fail instead of silently clamping")
	}
}

func TestTaskFlowPoolBudgetRejectsMalformedExplicitSettings(t *testing.T) {
	setTaskFlowPoolBudget(t, "8", "8", "0", "0", "1")
	t.Setenv("DATABASE_MAX_CONNS", "not-a-number")
	if err := validateTaskFlowPoolBudget(&pgxpool.Config{MaxConns: 8, MinConns: 0}, primaryPoolSizing); err == nil {
		t.Fatal("malformed explicit pool max must fail closed")
	}
}
