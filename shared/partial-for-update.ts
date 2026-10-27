import { z } from "zod";

type WithoutDefaults<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: Shape[Key] extends z.ZodDefault<infer Inner> ? Inner : Shape[Key];
};

/**
 * Keep creation defaults out of partial updates. Zod 4 applies defaults even
 * inside optional fields; an omitted update must never reset stored values.
 * These API objects use top-level defaults and the default strip-unknown policy.
 */
export function partialForUpdate<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.removeDefault() : field,
    ]),
  ) as WithoutDefaults<Shape>;
  return z.object(shape).partial();
}
