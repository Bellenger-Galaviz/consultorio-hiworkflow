"use client";

export function AutoSubmitDateInput({
  className,
  defaultValue,
  name
}: {
  className?: string;
  defaultValue: string;
  name: string;
}) {
  return (
    <input
      className={className}
      defaultValue={defaultValue}
      name={name}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      type="date"
    />
  );
}
