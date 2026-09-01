export function Button(props: {
  type?: 'submit' | 'button';
  children: React.ReactNode;
}) {
  return <button type={props.type ?? 'button'}>{props.children}</button>;
}
