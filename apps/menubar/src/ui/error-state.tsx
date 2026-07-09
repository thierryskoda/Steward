import { MessageState } from "./message-state.js";
import { ErrorIcon } from "./message-state-icons.js";

type IErrorStateProps = {
  title: string;
  message: string;
};

export function ErrorState({ title, message }: IErrorStateProps): JSX.Element {
  return <MessageState icon={<ErrorIcon />} title={title} description={message} />;
}
