import type { ReactNode } from "react";

type IMessageStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
};

export function MessageState({ icon, title, description }: IMessageStateProps): JSX.Element {
  return (
    <div className="mx-auto max-w-[420px] text-center">
      <div className="mb-5" aria-hidden="true">
        {icon}
      </div>
      <h3 className="mb-2 text-[22px] font-bold tracking-[-0.02em] text-text-primary">{title}</h3>
      <p className="whitespace-pre-wrap wrap-break-word text-[16px] text-text-secondary">
        {description}
      </p>
    </div>
  );
}
