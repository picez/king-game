// ---------------------------------------------------------------------------
// The emoji the chat picker types INTO a message. Client-only: these become plain
// characters of the chat text, which the server already sanitises like any other text
// (`filterChat`). Table reactions are a separate, server-whitelisted set (`REACTIONS`).
// ---------------------------------------------------------------------------

export const TEXT_EMOJI = [
  '😀', '😂', '🤣', '😊', '😉', '😍', '😘', '😎',
  '🤔', '😏', '😅', '🙃', '😇', '🥲', '😬', '😴',
  '😮', '😱', '🤯', '😢', '😭', '😡', '🤬', '🥳',
  '🤡', '🙈', '🤷', '👀', '👍', '👎', '👏', '🙏',
  '🤝', '💪', '👌', '✌️', '🤞', '👋', '❤️', '💔',
  '🔥', '⭐', '🎉', '🍀', '💰', '👑', '🃏', '♠️',
  '♥️', '♦️', '♣️', '🎯', '☕', '🍺',
] as const;
