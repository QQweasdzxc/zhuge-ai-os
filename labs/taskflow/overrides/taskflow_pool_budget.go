package main

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	taskFlowSessionBudgetEnv      = "TASKFLOW_DB_SESSION_BUDGET"
	taskFlowPrimaryBudgetEnv      = "TASKFLOW_DB_PRIMARY_SESSION_BUDGET"
	taskFlowReplicaBudgetEnv      = "TASKFLOW_DB_REPLICA_SESSION_BUDGET"
	taskFlowExternalReserveEnv    = "TASKFLOW_DB_EXTERNAL_SESSION_RESERVE"
	taskFlowAPIDeploymentCountEnv = "TASKFLOW_API_REPLICA_COUNT"
)

// validateTaskFlowPoolBudget makes the TaskFlow session allocation explicit.
// The declared budgets are non-secret deployment metadata and must be measured
// against all consumers before they are configured in a production service.
func validateTaskFlowPoolBudget(cfg *pgxpool.Config, sizing dbPoolSizing) error {
	if cfg == nil {
		return fmt.Errorf("TaskFlow database pool config is missing")
	}
	if cfg.MaxConns <= 0 {
		return fmt.Errorf("TaskFlow database pool max connections must be positive")
	}
	if cfg.MinConns < 0 || cfg.MinConns > cfg.MaxConns {
		return fmt.Errorf("TaskFlow database pool min connections must be between zero and max connections")
	}
	if err := validateExplicitPoolSetting(sizing.maxConnsEnv, true); err != nil {
		return err
	}
	if err := validateExplicitPoolSetting(sizing.minConnsEnv, false); err != nil {
		return err
	}

	totalBudget, err := requiredBudget(taskFlowSessionBudgetEnv, false)
	if err != nil {
		return err
	}
	primaryBudget, err := requiredBudget(taskFlowPrimaryBudgetEnv, true)
	if err != nil {
		return err
	}
	replicaBudget, err := requiredBudget(taskFlowReplicaBudgetEnv, true)
	if err != nil {
		return err
	}
	externalReserve, err := requiredBudget(taskFlowExternalReserveEnv, true)
	if err != nil {
		return err
	}
	deploymentCount, err := requiredBudget(taskFlowAPIDeploymentCountEnv, false)
	if err != nil {
		return err
	}
	if primaryBudget > totalBudget || replicaBudget > totalBudget-primaryBudget || externalReserve > totalBudget-primaryBudget-replicaBudget {
		return fmt.Errorf("TaskFlow primary, replica, and external session reservations exceed %s", taskFlowSessionBudgetEnv)
	}

	allocatedBudget := primaryBudget
	if sizing.maxConnsEnv == "DATABASE_REPLICA_MAX_CONNS" {
		allocatedBudget = replicaBudget
	}
	if int64(cfg.MaxConns) > int64(^uint64(0)>>1)/deploymentCount {
		return fmt.Errorf("TaskFlow configured pool size overflows the deployment budget calculation")
	}
	totalPoolMax := int64(cfg.MaxConns) * deploymentCount
	if totalPoolMax > allocatedBudget {
		return fmt.Errorf(
			"TaskFlow %s max connections across %s exceeds its declared session allocation",
			sizing.maxConnsEnv,
			taskFlowAPIDeploymentCountEnv,
		)
	}

	slog.Info("TaskFlow database session budget validated",
		"pool_max_conns", cfg.MaxConns,
		"pool_min_conns", cfg.MinConns,
		"api_replica_count", deploymentCount,
		"pool_session_budget", allocatedBudget,
		"external_session_reserve", externalReserve,
		"total_api_session_budget", totalBudget,
	)
	return nil
}

func requiredBudget(name string, allowZero bool) (int64, error) {
	raw, ok := os.LookupEnv(name)
	if !ok || raw == "" {
		return 0, fmt.Errorf("required non-secret TaskFlow database budget %s is missing", name)
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 || (!allowZero && value == 0) {
		return 0, fmt.Errorf("TaskFlow database budget %s must be a valid positive integer", name)
	}
	return value, nil
}

func validateExplicitPoolSetting(name string, positive bool) error {
	raw, ok := os.LookupEnv(name)
	if !ok || raw == "" {
		return nil
	}
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || value < 0 || (positive && value == 0) {
		return fmt.Errorf("TaskFlow database pool setting %s must be a valid %s integer", name, map[bool]string{true: "positive", false: "non-negative"}[positive])
	}
	return nil
}
