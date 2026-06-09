export const GRADIENTS: { name: string; css: string }[] = [
  { name: "blue", css: "linear-gradient(135deg, #4f8cff 0%, #1a4fff 100%)" },
  { name: "purple", css: "linear-gradient(135deg, #b06ef5 0%, #6e3ad2 100%)" },
  { name: "pink", css: "linear-gradient(135deg, #ff6f9c 0%, #d8326a 100%)" },
  { name: "red", css: "linear-gradient(135deg, #ff7059 0%, #d83026 100%)" },
  { name: "orange", css: "linear-gradient(135deg, #ffb05a 0%, #f07d1a 100%)" },
  { name: "yellow", css: "linear-gradient(135deg, #ffd24a 0%, #f0a51a 100%)" },
  { name: "green", css: "linear-gradient(135deg, #5ed273 0%, #2aa84b 100%)" },
  { name: "teal", css: "linear-gradient(135deg, #5cd5d2 0%, #1a9c98 100%)" },
  { name: "indigo", css: "linear-gradient(135deg, #6c70d8 0%, #3a3f9c 100%)" },
  { name: "graphite", css: "linear-gradient(135deg, #6d6d75 0%, #3a3a40 100%)" },
];

export const EMOJI_PICKS = [
  "💼", "📄", "📋", "🎯", "🚀", "💡", "🛠️", "🧠",
  "🏢", "🏭", "🏪", "🏥", "🏫", "🏦", "🌐", "📱",
  "💻", "🤖", "🔬", "📊", "📈", "🎨", "✏️", "📚",
];

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function gradientFor(name: string, override: string | null): string {
  if (override) {
    const found = GRADIENTS.find((g) => g.name === override);
    if (found) return found.css;
  }
  return GRADIENTS[hashString(name) % GRADIENTS.length].css;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
