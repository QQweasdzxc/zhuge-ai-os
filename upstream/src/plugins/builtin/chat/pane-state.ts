import { normalizeChannelId } from "./channels";

type ChatPaneSettings = Record<string, unknown>;

export function setChatPaneChannel(
  settings: ChatPaneSettings | undefined,
  nextChannelId: string,
): ChatPaneSettings {
  const normalizedNextChannelId = normalizeChannelId(nextChannelId);
  const currentChannelId = typeof settings?.channelId === "string"
    ? normalizeChannelId(settings.channelId)
    : null;
  const nextSettings = {
    ...(settings ?? {}),
    channelId: normalizedNextChannelId,
  };

  if (!currentChannelId || currentChannelId === normalizedNextChannelId) {
    return nextSettings;
  }

  return clearChatPaneTargetMessage(nextSettings);
}

export function clearChatPaneTargetMessage(
  settings: ChatPaneSettings | undefined,
): ChatPaneSettings {
  const { targetMessageId: _targetMessageId, ...nextSettings } = settings ?? {};
  return nextSettings;
}
