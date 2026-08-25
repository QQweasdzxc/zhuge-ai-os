# ADR-001 Creator Workspace Architecture（Creator Workspace 架構）

Status: Approved
Version: 1.0
Owner: Creator Workspace
Effective Date: 2026-08-07

## Purpose

Creator Workspace 為 Zhuge AI OS 唯一工作入口。

所有人員、AI、模組皆由 Creator Workspace 進入各 Center。

## Structure

Creator Workspace
├── Engineering Center（工程中心）
├── Investment Center（投資中心）
├── HR Center（人資中心）
├── Product Center（產品中心）
├── Knowledge Center（知識中心）
└── Governance Center（治理中心）

## Notes

- 每個 Center 擁有自己的 Kanban、Sprint、QA、Release。
- Knowledge Center 為所有 Center 共用。
- Governance Center 管理全域規則與決策。

## Approved

Creator Workspace
2026-08-07
