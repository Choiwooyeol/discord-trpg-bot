# Discord TRPG Bot

친구들과 Discord에서 플레이하는 자체 호스팅 한국어 AI TRPG 봇입니다. 각 게임은 별도 스레드에서 진행되고, 세션·행동·주사위 결과·Discord 발송 대기열을 SQLite에 저장합니다.

English: [README.en.md](README.en.md)

## 주요 기능

- 판타지, SF, 무협, 사이버펑크, 미스터리, 완전 랜덤 장르 캠페인
- 매 게임마다 새로 조합되는 장소, 세력, 사건, 목표, 첫 행동 선택지
- 자유 직업: `남궁세가 3대 가신`, `화성 광산 기술자`, `네트러너`처럼 직접 작성
- 1인 관리자 모드와 2~6명 멀티플레이
- 버튼 선택과 자유 행동 입력, 행동 충돌 투표, 기본 턴제 전투
- 장면 결과와 플레이어 행동을 Discord 기록으로 보존
- 서버 재시작 후 세션·주사위·보류된 AI 작업 복구
- Discord 중복 발송 방지 및 실패한 발송의 안전한 재시도

## 빠른 시작

Node.js 24.12 이상과 Discord 애플리케이션이 필요합니다.

```powershell
Copy-Item .env.example .env
# .env에 Discord 설정을 입력합니다.
npm run check
npm test
npm start
```

Discord 개발자 포털에서 봇을 만들고, 서버에 `bot`과 `applications.commands` 범위로 설치하세요. 필요한 권한은 채널 보기, 메시지 보내기, 메시지 기록 보기, 임베드 링크, 공개 스레드 만들기, 스레드 메시지 보내기입니다. 일반 채팅 행동 입력을 받으려면 **Message Content Intent**도 켜야 합니다.

자세한 설정은 [Discord 설정](docs/SETUP.md), 24시간 서버 운영은 [GCP 배포](docs/GCP_DEPLOY.md)를 참고하세요.

## AI 제공자

기본값은 `AI_PROVIDER=codex`입니다. 운영자가 공식 Codex CLI를 설치하고 자신의 ChatGPT 계정으로 로그인해야 합니다. 이 프로젝트에는 토큰, 계정, Codex 로그인 정보가 포함되지 않습니다.

`AI_PROVIDER=openai`로 바꾸면 운영자 자신의 OpenAI API 키와 비용 설정이 필요합니다. Codex 인증이 실패했을 때 유료 API로 자동 전환하지 않습니다.

## Discord에서 플레이하기

1. 로비에서 `/게임시작` 또는 관리자 전용 `/혼자시작`을 실행합니다.
2. 새 모험 스레드에서 빠른 역할 버튼을 누르거나 `/캐릭터`로 자유 직업과 강점을 작성합니다.
3. 모두 `준비 완료`를 누르고 파티장이 `모험 시작`을 누릅니다.
4. 선택 버튼을 누르거나 채팅에 행동을 적습니다. `//`로 시작하는 메시지는 잡담입니다.

시작할 때 `장르`를 비우면 완전 랜덤, 또는 판타지·SF·무협·사이버펑크·미스터리 중 하나를 고를 수 있습니다. `언어`를 English로 고르면 새 세계와 AI 서술은 영어로 생성됩니다. 자유 직업의 `강점`은 전투·탐험·기술·교섭 중 하나로 정하며 주사위 판정에 연결됩니다.

## 검증과 운영

```powershell
npm test             # 단위 및 회귀 테스트
npm run check        # 설정과 SQLite 점검
npm run public-check # 공개 전 문서·비밀정보 점검
npm run status       # 현재 세션 요약
npm run backup       # SQLite 백업
```

배포 스크립트는 코드와 데이터·환경 파일을 분리하며, 새 릴리스의 테스트와 상태 확인이 실패하면 이전 릴리스로 복구합니다. 운영 절차는 [운영 가이드](docs/OPERATIONS.md)에 있습니다.

## 데이터와 한계

게임 스레드 안의 사용자 ID, 표시 이름, 캐릭터, 행동, 생성된 이야기와 세션 상태가 운영자의 SQLite DB에 저장됩니다. 자세한 내용은 [개인정보](PRIVACY.md)를 참고하세요.

AI는 이야기와 행동 해석을 돕지만 판정·저장·Discord 발송은 봇이 통제합니다. 전투는 기본 규칙만 제공하며 PvP, 비밀 DM, 대규모 캠페인 메모리는 아직 지원하지 않습니다.

보안 안내는 [SECURITY.md](SECURITY.md), 기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md), 변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 있습니다. 이 프로젝트는 [MIT License](LICENSE)로 배포됩니다.

다음 개발 방향은 [제품 로드맵](docs/ROADMAP.md)에 정리했습니다.
