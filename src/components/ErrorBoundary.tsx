import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message?: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private recover = () => {
    this.setState({ hasError: false, message: undefined })
    window.location.assign('/')
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
            <p className="text-sm text-slate-600">
              The screen hit an unexpected error. Your data is safe — go back to the dashboard and try again.
            </p>
            {this.state.message && (
              <p className="text-xs text-slate-400 font-mono break-all">{this.state.message}</p>
            )}
            <Button onClick={this.recover}>Back to Dashboard</Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
