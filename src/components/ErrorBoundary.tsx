import { Component, type ErrorInfo, type ReactNode } from 'react'

// 렌더 중 예외가 나도 흰 화면 대신 안내를 보인다. 오류 원문은 화면에 내지 않고 console.error로만 남긴다.
type State = { failed: boolean }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('화면을 그리다 오류가 났어요.', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: 'var(--bg)',
          color: 'var(--text-strong)',
          fontFamily: 'var(--font)',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>문제가 생겼어요</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            minHeight: 48,
            padding: '0 24px',
            border: 0,
            borderRadius: 12,
            background: 'var(--primary)',
            color: 'var(--on-primary)',
            fontFamily: 'inherit',
            fontSize: 16,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          다시 불러오기
        </button>
      </div>
    )
  }
}
