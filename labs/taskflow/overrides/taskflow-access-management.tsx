"use client";

import React from "react";
import { SettingsTab } from "./settings-layout";

export function TaskFlowAccessManagement() {
  return <SettingsTab title="全站存取管理">
    <p className="text-body text-muted-foreground">需全站管理者登入，請另開管理頁進行設定。</p>
    <a className="inline-flex rounded-lg border border-input px-4 py-2 text-body hover:bg-surface-hover"
      href="https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/access-management/"
      target="_blank" rel="noopener noreferrer">開啟全站存取管理</a>
  </SettingsTab>;
}
