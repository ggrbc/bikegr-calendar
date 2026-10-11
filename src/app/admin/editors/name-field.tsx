import { inputClass, labelClass } from "../_components/ui";

/**
 * The required Name input, shared by the invite form, the edit page, and the account page. No
 * `maxLength`: the browser counts UTF-16 units and the server counts code points, so the server
 * message decides.
 */
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
        autoComplete="name"
        defaultValue={defaultValue}
        className={inputClass}
      />
    </>
  );
}
