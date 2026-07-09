import type { ReactNode } from "react";
import { Component } from "react";

type IAppErrorBoundaryProps = {
  children: ReactNode;
};

type IAppErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class AppErrorBoundary extends Component<IAppErrorBoundaryProps, IAppErrorBoundaryState> {
  override state: IAppErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): IAppErrorBoundaryState {
    return { hasError: true, error };
  }

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="flex w-full flex-col p-6">
          <h2 className="mb-2 text-[22px] font-bold tracking-[-0.02em] text-text-primary">
            Something went wrong
          </h2>
          <p className="text-[16px] text-text-secondary">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
