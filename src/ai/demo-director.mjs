export class DemoDirector {
  // Explicit offline fixture, never a production fallback.
  async campaign(context) {
    const english = context.world?.language === 'en';
    return english ? {
      name: 'Offline demonstration', location: 'Demonstration transit hall', premise: 'A courier needs a witness for a disputed delivery.',
      objective: 'Decide whether to help the courier.', factions: ['Transit union', 'Courier association'],
      facts: ['The courier has an unsigned delivery receipt.', 'The platform gates are still open.'],
      opening: 'Your story begins in a busy transit hall. Courier Mira holds out an unsigned receipt as the station bell rings. She needs a witness before her cargo departs. The supervisor wants the platform cleared, but you are free to investigate, negotiate a fee, or leave on your own business.',
      starterChoices: [{ label: 'Investigate the receipt', intent: 'Inspect the disputed delivery receipt' }, { label: 'Talk to Mira', intent: 'Ask Mira what she is willing to offer for help' }, { label: 'Leave the hall', intent: 'Decline and leave the transit hall' }]
    } : {
      name: '오프라인 시연', location: '시연용 환승 광장', premise: '배달원이 분쟁 중인 화물의 인수 증인을 찾는다.',
      objective: '배달원을 도울지 결정한다.', factions: ['운송 조합', '배달원 협회'],
      facts: ['배달원은 서명 없는 인수증을 가지고 있다.', '승강장 문은 아직 열려 있다.'],
      opening: '환승 광장은 떠날 사람과 도착한 화물로 분주합니다. 배달원 미라는 서명 없는 인수증을 내밀며 증인이 되어 달라고 부탁합니다. 관리인은 승강장을 비우라고 재촉하지만, 아직 출발 종은 울리지 않았습니다. 인수증을 살피거나 보수를 협상할 수도 있고, 부탁을 거절하고 자신의 일을 찾아 떠날 수도 있습니다.',
      starterChoices: [{ label: '인수증 조사', intent: '분쟁 중인 화물의 인수증을 조사한다' }, { label: '보수 협상', intent: '미라에게 도움의 대가를 제안한다' }, { label: '광장 떠나기', intent: '부탁을 거절하고 환승 광장을 떠난다' }]
    };
  }
  async interpret(context) {
    const actions = Array.isArray(context.actions) ? context.actions : Object.entries(context.actions || {}).map(([userId, value]) => ({ userId, ...(typeof value === 'object' ? value : { text: value }) }));
    return { actions: actions.map(a => ({ userId: String(a.userId ?? a.id), intent: String(a.intent ?? a.text ?? a.value ?? '주변을 살핀다').slice(0, 500), classification: 'PARALLEL', ability: null, difficulty: 10, group: 'scene' })), combat: null };
  }
  async narrate(context) {
    return { narration: '안개가 걷히자 오래된 숲길과 희미한 등불이 모습을 드러냅니다. 멀리서 나뭇가지가 부러지는 소리가 들립니다.', location: context.world?.location || '안개 낀 숲길', facts: ['숲길은 두 갈래로 나뉜다', '등불 근처에서 발자국이 발견된다'], choices: [{ label: '등불을 조사한다', intent: '등불과 주변을 조사한다' }, { label: '발자국을 따라간다', intent: '발자국의 주인을 추적한다' }, { label: '동료들과 대열을 정비한다', intent: '안전하게 주변을 경계한다' }], summary: `${context.summary || ''} 일행은 안개 낀 숲길에 도착했다.`.slice(0, 3000) };
  }
}
