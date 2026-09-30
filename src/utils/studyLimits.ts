/** Bound history depth separately from the number of alternatives in a study. */
export const MAX_STUDY_LINE_MOVES = 1024;
export const MAX_STUDY_TREE_NODES = 8192;

export type StudyCapacityError = 'full' | 'line-full';

export function studyCapacityError(nodeCount: number, nextPly: number): StudyCapacityError | undefined {
    if (nextPly > MAX_STUDY_LINE_MOVES) return 'line-full';
    if (nodeCount > MAX_STUDY_TREE_NODES) return 'full';
    return undefined;
}

export function studyCapacityMessage(error: StudyCapacityError): string {
    return error === 'line-full'
        ? `This line has reached its ${MAX_STUDY_LINE_MOVES}-move limit. Start a new study from this position to continue.`
        : `This study has reached its ${MAX_STUDY_TREE_NODES}-move limit. Remove a variation or start a new study to continue.`;
}
