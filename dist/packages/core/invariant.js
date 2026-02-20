export const invariant_planBeforeAction = () => ({
    name: 'plan_before_action',
    description: 'All tool requests must be preceded by a decision.',
    check: async (ctx) => {
        return { valid: true, severity: 'warn' };
    },
});
