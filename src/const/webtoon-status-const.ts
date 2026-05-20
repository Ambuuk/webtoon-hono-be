export const NEW = "NEW"
export const PUBLISHED = "PUBLISHED"
export const HIDDEN = "HIDDEN"

export const ADMIN_ROLE = "ADMIN"
export const TRANSLATOR_ROLE = "TRANSLATOR"
export const MODERATOR_ROLE = "MODERATOR"
export const USER_ROLE = "USE"

export enum TranslationStatus {
    UP_TO_DATE = "UP_TO_DATE",
    CATCHING_UP = "CATCHING_UP",
    ON_HIATUS = "ON_HIATUS",
    COMPLETED = "COMPLETED",
}

export const TranslationStatusLabel: Record<TranslationStatus, string> = {
    [TranslationStatus.UP_TO_DATE]: "Гаргалтаа гүйцсэн",
    [TranslationStatus.CATCHING_UP]: "Орчуулж байгаа",
    [TranslationStatus.ON_HIATUS]: "Зураач завсарласан",
    [TranslationStatus.COMPLETED]: "Дууссан",
};