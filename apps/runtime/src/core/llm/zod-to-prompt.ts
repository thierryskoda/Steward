/**
 * Type-safe schema property getter for use in prompt builders. Enables referencing schema keys in prompts without duplicating strings; use when building agent prompts that mention output field names.
 */
import { z } from "zod";

type ISchemaPropertyGetter<T extends z.AnyZodObject> = (key: keyof T["shape"] & string) => string;

/**
 * Creates a type-safe schema property getter.
 * Returns the key as-is, but only allows keys that exist on the schema.
 */
export function createSchemaPropertyGetter<T extends z.AnyZodObject>(
  _schema: T
): ISchemaPropertyGetter<T> {
  return (key: keyof T["shape"] & string) => {
    return key;
  };
}
