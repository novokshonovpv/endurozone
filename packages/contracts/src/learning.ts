export interface Lesson {
  id: string;
  version: number;
  order: number;
  title: string;
  summary: string;
  sections: { title: string; body: string; points: string[] }[];
  takeaway: string;
  action: { label: string; path: string };
  sources: { title: string; url: string }[];
}
export interface LearningCatalog {
  title: string;
  description: string;
  level: "beginner";
  lessons: Lesson[];
}
export interface LessonProgress {
  lessonId: string;
  version: number;
  readAt: string | null;
}
export interface LearningProgress {
  items: LessonProgress[];
}
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const text = { type: "string" };
const version = { type: "integer", minimum: 1 };
const lesson = obj({
  id: text,
  version,
  order: { type: "integer" },
  title: text,
  summary: text,
  sections: {
    type: "array",
    items: obj({
      title: text,
      body: text,
      points: { type: "array", items: text },
    }),
  },
  takeaway: text,
  action: obj({ label: text, path: text }),
  sources: {
    type: "array",
    items: obj({ title: text, url: { type: "string", format: "uri" } }),
  },
});
const progress = obj({
  lessonId: text,
  version,
  readAt: { type: ["string", "null"], format: "date-time" },
});
export const learningSchemas = {
  id: obj({ lessonId: { type: "string", pattern: "^[a-z0-9-]{1,60}$" } }),
  mark: obj({ read: { type: "boolean" }, version }),
};
export const learningResponses = {
  catalog: obj({
    title: text,
    description: text,
    level: { type: "string", const: "beginner" },
    lessons: { type: "array", items: lesson },
  }),
  progress: obj({ items: { type: "array", items: progress } }),
  mark: progress,
};
