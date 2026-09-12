const GENRES = {
  fantasy: {
    name: '판타지', titles: ['별이 꺼진 왕국', '유리 달의 국경', '잿빛 용맥의 도시'],
    locations: ['왕도 외곽의 오래된 관문', '안개 낀 변경 마을', '무너진 성채의 시장'],
    threats: ['봉인에서 새어 나온 그림자', '왕실 문서를 훔친 밀수단', '사라진 수호자의 마지막 경고'],
    factions: ['왕도 경비대', '달그림자 상단', '옛 서약의 수호자'],
    details: ['젖은 돌바닥에 푸른 인장이 번진다', '종소리와 함께 까마귀들이 날아오른다', '누군가 불에 그을린 지도를 남겼다']
  },
  sf: {
    name: 'SF', titles: ['태양계 밖 마지막 신호', '오로라 정거장의 침묵', '화성 궤도의 유령선'],
    locations: ['저궤도 정거장의 격리 구역', '붉은 행성의 채굴 도시', '항성 화물선의 폐쇄 갑판'],
    threats: ['사라진 탐사대가 남긴 암호 신호', '통제를 벗어난 유지보수 인공지능', '산소 배급 기록을 조작한 누군가'],
    factions: ['정거장 관리국', '독립 화물선 조합', '기억 복구 연구소'],
    details: ['비상등이 느리게 붉은 빛을 뿜는다', '통신기에서 끊긴 목소리가 반복된다', '기압문 너머에 정체불명의 발자국이 남아 있다']
  },
  martial: {
    name: '무협', titles: ['흑룡표국의 마지막 의뢰', '강호에 떨어진 비급', '청운검의 사라진 후계자'],
    locations: ['비 내리는 객잔의 뒤뜰', '장강 나루터의 어시장', '산문 아래의 장터'],
    threats: ['사라진 표물과 배신자의 소문', '가문을 가른 오래된 혈서', '무림맹을 노리는 독문의 거래'],
    factions: ['남궁세가의 외당', '흑룡표국', '강호 정보상 연맹'],
    details: ['처마 끝에서 빗물이 검집 위로 떨어진다', '찻잔 아래에 암호가 새겨져 있다', '객잔 주인이 손님들의 이름을 숨긴다']
  },
  cyberpunk: {
    name: '사이버펑크', titles: ['네온 아래의 실종자', '제로데이 거리의 반란', '도시 운영체제의 거짓말'],
    locations: ['비에 젖은 하층가 야시장', '기업탑의 서비스 통로', '불법 개조 클리닉 뒤편'],
    threats: ['삭제된 시민 기록과 사라진 의뢰인', '기업 AI가 감춘 감시 영상', '구역 전체를 멈출 수 있는 해킹 키'],
    factions: ['오로라 메가코프', '지하 네트러너 연합', '하층가 자치단'],
    details: ['간판 불빛이 웅덩이 위에서 깨진다', '드론이 같은 골목을 세 번째 선회한다', '익명 발신자가 일회용 칩을 건넨다']
  },
  mystery: {
    name: '미스터리', titles: ['비 내리는 저택의 일곱 번째 방', '사라진 마을의 초대장', '새벽 종이 울린 뒤'],
    locations: ['봉쇄된 저택의 현관홀', '기차역 근처의 오래된 호텔', '안개에 묻힌 호숫가 마을'],
    threats: ['모두가 기억하지 못하는 하룻밤', '잠긴 방에서 사라진 증거', '마을 전체가 숨기는 한 사람의 이름'],
    factions: ['지역 경찰서', '저택 관리인들', '익명의 초대장 발신자'],
    details: ['시계는 모두 같은 시각에 멈춰 있다', '복도 끝에서 젖은 발자국이 끊긴다', '식탁 위 초가 하나만 새로 녹아 있다']
  }
};

const legacyGenre = { harbor: 'fantasy', desert: 'fantasy', library: 'mystery', festival: 'fantasy' };
const hash = value => [...String(value)].reduce((n, ch) => ((n * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
const pick = (values, seed, offset) => values[(seed + offset) % values.length];

export const CAMPAIGN_GENRES = Object.freeze(Object.entries(GENRES).map(([id, genre]) => ({ id, name: genre.name })));

export function createCampaign({ id, genre, tone, name } = {}) {
  const requested = String(genre ?? '').trim().toLowerCase();
  const genreId = GENRES[requested] ? requested : legacyGenre[requested] || CAMPAIGN_GENRES[hash(id) % CAMPAIGN_GENRES.length].id;
  const source = GENRES[genreId];
  const seed = hash(id || `${genreId}:${name}:${tone}`);
  const title = String(name || '').trim() || pick(source.titles, seed, 1);
  const location = pick(source.locations, seed, 2);
  const threat = pick(source.threats, seed, 3);
  const factions = [pick(source.factions, seed, 4), pick(source.factions, seed, 5)].filter((x, index, all) => all.indexOf(x) === index);
  const detail = pick(source.details, seed, 6);
  return {
    name: title, genre: source.name, genreId, tone: String(tone || source.name).slice(0, 200), location,
    premise: threat, factions, objective: `${threat}의 진상을 밝히고, 그 결과를 스스로 결정한다.`,
    facts: [threat, `${factions[0]}이(가) 이 사건의 일부를 알고 있다.`, detail],
    opening: `${location}에서 시작합니다. ${detail}. 지금 이곳을 흔드는 문제는 ${threat}입니다. 누구를 믿고 어떤 대가를 치를지는 일행의 선택에 달려 있습니다.`,
    starterChoices: [
      { label: '현장 조사', intent: `${location}의 흔적과 증거를 직접 조사한다` },
      { label: '세력 접촉', intent: `${factions[0]}의 인물을 찾아 정보를 거래하거나 압박한다` },
      { label: '독자 행동', intent: '정해진 단서를 따르지 않고, 각자의 방식으로 상황을 바꿀 계획을 실행한다' }
    ]
  };
}
