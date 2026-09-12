export class DemoDirector {
  async interpret(context) {
    const actions = Array.isArray(context.actions) ? context.actions : Object.entries(context.actions || {}).map(([userId, value]) => ({ userId, ...(typeof value === 'object' ? value : { text: value }) }));
    return { actions: actions.map(a => ({ userId: String(a.userId ?? a.id), intent: String(a.intent ?? a.text ?? a.value ?? '주변을 살핀다').slice(0, 500), classification: 'PARALLEL', ability: null, difficulty: 10, group: 'scene' })), combat: null };
  }
  async narrate(context) {
    return { narration: '안개가 걷히자 오래된 숲길과 희미한 등불이 모습을 드러냅니다. 멀리서 나뭇가지가 부러지는 소리가 들립니다.', location: context.world?.location || '안개 낀 숲길', facts: ['숲길은 두 갈래로 나뉜다', '등불 근처에서 발자국이 발견된다'], choices: [{ label: '등불을 조사한다', intent: '등불과 주변을 조사한다' }, { label: '발자국을 따라간다', intent: '발자국의 주인을 추적한다' }, { label: '동료들과 대열을 정비한다', intent: '안전하게 주변을 경계한다' }], summary: `${context.summary || ''} 일행은 안개 낀 숲길에 도착했다.`.slice(0, 3000) };
  }
}
