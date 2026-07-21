import { useState } from 'react'

/** Original straw-hat mark (generic hat — not any copyrighted character). */
function HatMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="32"
        cy="44"
        rx="26"
        ry="8"
        fill="#e6bd7d"
        stroke="#6f421f"
        strokeWidth="3"
      />
      <path
        d="M19 44C19 26 23 18 32 18C41 18 45 26 45 44Z"
        fill="#f0cb8b"
        stroke="#6f421f"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M19.5 41C26 45 38 45 44.5 41L44.5 34.5C38 38.5 26 38.5 19.5 34.5Z"
        fill="#ff4747"
      />
      <ellipse
        cx="32"
        cy="44"
        rx="26"
        ry="8"
        fill="none"
        stroke="#6f421f"
        strokeWidth="3"
      />
    </svg>
  )
}

/**
 * Brand logo. Prefers a user-supplied image at /logo.png (drop your own art
 * there and it appears automatically), otherwise falls back to the straw-hat
 * mark. `wordmark` shows the "LUFF·SNIPER" text alongside.
 */
export function Logo({
  size = 26,
  wordmark = true,
}: {
  size?: number
  wordmark?: boolean
}) {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <span className="logo-wrap">
      {imgFailed ? (
        <HatMark size={size} />
      ) : (
        <img
          src="/logo.png"
          alt=""
          width={size}
          height={size}
          className="logo-img"
          onError={() => setImgFailed(true)}
        />
      )}
      {wordmark && <span className="logo glow">LUFF·SNIPER</span>}
    </span>
  )
}
