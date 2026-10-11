import { inputClass, labelClass } from "../_components/ui";

/** The required Name input, shared by the invite form, the edit page, and the account page. */
export function NameField({ id, defaultValue }: { id: string; defaultValue?: string }) {
  return (
    <>
      <label htmlFor={id} className={labelClass}>
        Name
      </label>
      <input
        id={id}
        name="name"
        type="text"
        required
        maxLength={100}
        autoComplete="name"
        defaultValue={defaultValue}
        className={inputClass}
      />
    </>
  );
}
