export type OnboardingStepId = "bike" | "post" | "follow" | "social";
export const onboardingSteps: Record<
  OnboardingStepId,
  { title: string; hint: string; path: string; action: string }
> = {
  bike: {
    title: "Добавьте свой мотоцикл",
    hint: "Марка, модель и год — остальное можно позже.",
    path: "garage",
    action: "Открыть гараж",
  },
  post: {
    title: "Напишите первую запись",
    hint: "Покатушка, обслуживание или доработка; можно оставить только для себя.",
    path: "garage",
    action: "Запись в гараже",
  },
  follow: {
    title: "Подпишитесь на райдера",
    hint: "Его открытые записи появятся во вкладке «Мои подписки».",
    path: "riders",
    action: "Найти райдеров",
  },
  social: {
    title: "Сделайте шаг навстречу",
    hint: "Прокомментируйте или сохраните чужую запись, подайте заявку на покатушку.",
    path: "feed",
    action: "В сообщество",
  },
};
export interface Onboarding {
  steps: { id: OnboardingStepId; done: boolean }[];
  complete: boolean;
  dismissed: boolean;
}
export interface ActivationSummary {
  participants: number;
  bike: number;
  post: number;
  follow: number;
  social: number;
  activated: number;
  eligibleForReturn: number;
  returned: number;
  excludedModerators: number;
  excludedSynthetic: number;
}
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
const count = { type: "integer", minimum: 0 };
export const onboardingSchemas = {
  update: obj({ dismissed: { type: "boolean" } }),
};
export const onboardingResponses = {
  onboarding: obj({
    steps: {
      type: "array",
      items: obj({
        id: { type: "string", enum: Object.keys(onboardingSteps) },
        done: { type: "boolean" },
      }),
    },
    complete: { type: "boolean" },
    dismissed: { type: "boolean" },
  }),
  activation: obj({
    participants: count,
    bike: count,
    post: count,
    follow: count,
    social: count,
    activated: count,
    eligibleForReturn: count,
    returned: count,
    excludedModerators: count,
    excludedSynthetic: count,
  }),
};
