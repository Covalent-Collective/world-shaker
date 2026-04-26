-- ===========================================================================
-- World Shaker — Alpha seed pool (US-406)
--
-- Source: .omc/plans/world-shaker-ux-v1-plan.md Step 4.6 (R4 mitigation).
-- Alpha-stage launch lever: prevents empty-pool problem at launch by
-- providing 12 synthetic seed users + agents that match_candidates() can
-- surface until active real-user count reaches ~100.
--
-- Key design decisions:
--   * app_settings.seed_pool_active BOOLEAN lets ops flip off the pool
--     post-launch without a migration (e.g. once user count >= 100).
--   * agents.is_seed=true marks rows for pool-mix logic in first-encounter
--     and stroll Inngest fns (mix ratio: 100% at <10 users, linear to 0%
--     at 100+, per plan AC-R4).
--   * embeddings are placeholder zeros — production recomputes via
--     embedText() at first match_candidates() call for each seed. The HNSW
--     partial index covers them once embedding is non-null.
--   * nullifier='seed_user_<n>', action='seed' satisfies the
--     UNIQUE(nullifier, action) constraint without colliding with real users
--     (real users have action='sign_in' or 'sign_up' from World ID SDK).
--   * verification_level='orb' satisfies the CHECK constraint from 0001.
--
-- Companion rollback: 0003_rollback.sql (DELETE FROM users WHERE nullifier
-- LIKE 'seed_user_%' + DROP COLUMN app_settings.seed_pool_active).
-- ===========================================================================

-- ---------- app_settings: seed pool feature flag ------------------------
alter table public.app_settings
  add column if not exists seed_pool_active boolean not null default true;

-- ---------- seed inserts (single transaction) ---------------------------
begin;

-- Persona 1: Creative introvert — visual artist, dreamy, values depth
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_1', 'seed', null, 'seed_1', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '오래된 영화를 혼자 보다가 예상치 못한 장면에서 웃음이 터질 때요. 아무도 없는데 혼자 웃고 있으면 왠지 더 순수한 것 같아서.',
    'q2_surprised',       '새벽에 작업하다 보면 시간이 얼마나 흘렀는지 모를 때가 있어요. 그게 좋은 놀라움이에요.',
    'q3_working_through', '혼자 산책하면서 생각을 정리해요. 말로 꺼내기 전에 먼저 이미지로 떠올려야 해요.',
    'q4_alone_time',      '혼자 있는 시간이 충전이에요. 음악 들으면서 스케치하거나 그냥 멍하니 창밖 보는 것도요.',
    'q5_grateful',        '완성된 작품을 보면서 "이게 내 손에서 나왔구나" 싶을 때요. 작은 것이어도 괜찮아요.',
    'q6_small_try',       '수채화 시작하려고 팔레트 샀는데 아직 포장도 못 뜯었어요. 이번 주는 꼭 해보려고요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'reflective',
    'interests',  jsonb_build_array('visual art', 'film', 'sketching', 'solitude'),
    'values',     'depth',
    'age_band',   '20s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_1';

-- Persona 2: Analytical + playful — data nerd who loves board games and dad jokes
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_2', 'seed', null, 'seed_2', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '누군가가 내 아재 개그에 진짜 웃어줄 때요. 억지로 웃는 건지 아닌지 구별할 수 있거든요.',
    'q2_surprised',       '엑셀 피벗 테이블이 처음 딱 맞아 떨어질 때. 진짜 소름 돋아요.',
    'q3_working_through', '문제를 종이에 쭉 써 내려가요. 쓰면서 정리가 돼요. 혼잣말도 해요.',
    'q4_alone_time',      '보드게임 룰북 읽는 거 좋아해요. 실제로 게임 안 해도 룰 이해하는 것 자체가 재미있어요.',
    'q5_grateful',        '아침에 커피 한 잔이랑 조용한 시간이요. 단순하지만 하루의 기준점이 돼요.',
    'q6_small_try',       '루빅스 큐브 3x3 처음 혼자 맞췄을 때요. 알고리즘 외우는 게 생각보다 재미있었어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'playful',
    'interests',  jsonb_build_array('board games', 'data analysis', 'logic puzzles', 'coffee'),
    'values',     'intellectual curiosity',
    'age_band',   '30s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_2';

-- Persona 3: Calm + ambitious — yoga teacher with startup ambitions
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_3', 'seed', null, 'seed_3', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '수업 중에 학생이 예상치 못한 말을 툭 던질 때요. 요가 하다가도 웃음이 나와요.',
    'q2_surprised',       '새벽 5시에 혼자 매트 폈을 때 그 고요함이요. 아직도 매번 새로워요.',
    'q3_working_through', '몸을 움직여요. 생각이 많을 때일수록 30분 빠르게 걷거나 시퀀스 만들어봐요.',
    'q4_alone_time',      '노트에 아이디어 적는 거요. 사업 아이디어든 그냥 관찰이든, 쓰면서 정리돼요.',
    'q5_grateful',        '학생이 "선생님 덕분에 달라진 것 같아요"라고 할 때요. 그 말이 오래 남아요.',
    'q6_small_try',       '온라인 클래스 런칭 준비 중이에요. 카메라 앞이 아직 어색한데 계속 연습 중이에요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'grounded',
    'interests',  jsonb_build_array('yoga', 'entrepreneurship', 'wellness', 'teaching'),
    'values',     'growth',
    'age_band',   '30s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_3';

-- Persona 4: Extrovert + warm — community organiser, loves cooking for crowds
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_4', 'seed', null, 'seed_4', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '집에 사람들 모아서 밥 먹다가 동시에 다들 터질 때요. 그 에너지가 진짜 좋아요.',
    'q2_surprised',       '처음 만난 사람이랑 두 시간 넘게 얘기했는데 헤어질 때 서운할 때요.',
    'q3_working_through', '친구한테 전화해요. 말하면서 풀려요. 혼자 생각하면 더 꼬이는 타입이에요.',
    'q4_alone_time',      '솔직히 혼자 있는 게 잘 안 돼요. 요리하면서 팟캐스트 듣는 게 제일 편해요.',
    'q5_grateful',        '요리한 걸 사람들이 맛있게 먹을 때요. 그게 제일 보람 있어요.',
    'q6_small_try',       '동네 플리마켓 운영 시작했어요. 작게 시작했는데 생각보다 반응이 좋아서 계속하고 있어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'warm',
    'interests',  jsonb_build_array('cooking', 'community', 'hosting', 'podcasts'),
    'values',     'connection',
    'age_band',   '20s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_4';

-- Persona 5: Curious + independent — traveller, linguistics nerd
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_5', 'seed', null, 'seed_5', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '다른 언어의 번역이 완전히 틀렸을 때요. 구글 번역 오류 모으는 취미 있어요.',
    'q2_surprised',       '낯선 도시에서 길을 잃었는데 오히려 더 좋은 걸 발견할 때요.',
    'q3_working_through', '지도 펼치고 이동 경로 짜는 게 생각 정리에도 도움이 돼요. 지도 보면 진정이 돼요.',
    'q4_alone_time',      '이어폰 없이 카페에 앉아서 주변 소리 들으며 그 나라 말 들어보는 거요.',
    'q5_grateful',        '스스로 계획 짜서 처음 혼자 한 여행이요. 그게 저한테는 진짜 전환점이었어요.',
    'q6_small_try',       '일본어 N2 따려고 공부 시작했어요. 독해는 괜찮은데 청해가 아직 어려워요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'curious',
    'interests',  jsonb_build_array('travel', 'linguistics', 'maps', 'language learning'),
    'values',     'independence',
    'age_band',   '20s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_5';

-- Persona 6: Thoughtful + dry humour — software engineer, minimalist aesthetic
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_6', 'seed', null, 'seed_6', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '코드 리뷰 댓글이 생각보다 웃길 때요. "이게 왜 돼요?"가 최고예요.',
    'q2_surprised',       '버그 고치다가 그게 사실 기능이었다는 걸 뒤늦게 알았을 때요.',
    'q3_working_through', '독 안에 혼자 고민하면 안 되는 타입이에요. 오리 고무인형한테 설명하는 기법 씁니다.',
    'q4_alone_time',      '책상 정리해요. 물건 줄이면 머리도 정리되는 것 같아요.',
    'q5_grateful',        '아무것도 없는 화면에서 뭔가 만들어냈을 때요. 그 처음 느낌이 아직도 좋아요.',
    'q6_small_try',       '홈 서버 구축 중이에요. 설정하면 할수록 뭔가 더 해야 할 게 생겨서 언제 끝날지 모르겠어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'dry',
    'interests',  jsonb_build_array('software', 'minimalism', 'tinkering', 'rubber duck debugging'),
    'values',     'craftsmanship',
    'age_band',   '30s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_6';

-- Persona 7: Earnest + outdoorsy — amateur climber, environmentalist
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_7', 'seed', null, 'seed_7', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '등반 중에 파트너가 루트 읽다가 완전 틀렸을 때요. 근데 그래도 어떻게든 올라가요.',
    'q2_surprised',       '산 정상에서 구름이 딱 걷힐 때요. 기다린 보람이 있을 때.',
    'q3_working_through', '산에 가요. 올라가면서 생각하고, 내려오면 대부분 정리돼 있어요.',
    'q4_alone_time',      '텐트 치고 혼자 저녁 해 먹는 거요. 아무것도 안 해도 되는 그 시간이요.',
    'q5_grateful',        '텀블러 하나 바꿨을 뿐인데 일회용 줄어든 게 느껴질 때요. 작은 변화가 쌓이는 게 좋아요.',
    'q6_small_try',       '실내 클라이밍 시작한 게 이제 3년이 됐어요. 그 시절 나한테 잘했다고 말해주고 싶어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'earnest',
    'interests',  jsonb_build_array('rock climbing', 'camping', 'environment', 'sustainability'),
    'values',     'intentionality',
    'age_band',   '20s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_7';

-- Persona 8: Sentimental + storyteller — writer, collects old letters
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_8', 'seed', null, 'seed_8', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '오래된 일기 읽다가 그때 내가 진지하게 고민했던 게 지금 보면 우스울 때요.',
    'q2_surprised',       '버려진 편지 묶음을 헌책방에서 발견했어요. 모르는 사람들의 이야기가 거기 있었어요.',
    'q3_working_through', '손으로 써요. 키보드 말고. 쓰다 보면 내가 뭘 느끼는지 나와요.',
    'q4_alone_time',      '도서관 맨 구석 자리요. 사람이 많은데 혼자일 수 있는 묘한 공간이에요.',
    'q5_grateful',        '독자한테서 "이 글 덕분에 용기 냈어요"라는 메시지 받을 때요.',
    'q6_small_try',       '단편 소설 공모전에 처음 냈을 때요. 떨어졌는데 그래도 보냈다는 게 좋았어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'poetic',
    'interests',  jsonb_build_array('writing', 'letters', 'libraries', 'storytelling'),
    'values',     'authenticity',
    'age_band',   '30s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_8';

-- Persona 9: Pragmatic + nurturing — nurse, volunteers on weekends
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_9', 'seed', null, 'seed_9', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '야간 근무 끝나고 동료들이랑 편의점 앞에서 멍하니 있다가 이유 없이 웃을 때요.',
    'q2_surprised',       '퇴원하면서 인사 안 했던 환자분이 한 달 후에 과자 들고 다시 오실 때요.',
    'q3_working_through', '청소해요. 손 움직이면 머리가 비워져요. 청소 끝나면 어느 정도 정리돼 있어요.',
    'q4_alone_time',      '따뜻한 물에 발 담그고 유튜브 보는 거요. 아무 생각 없이 볼 수 있는 요리 영상이요.',
    'q5_grateful',        '내가 잘 챙겨줬던 분이 회복해서 퇴원하는 날이요. 그게 제일 보람이에요.',
    'q6_small_try',       '주말 봉사 시작할 때 두 달 해보고 그만두려 했는데, 이제 3년째 하고 있어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'nurturing',
    'interests',  jsonb_build_array('nursing', 'volunteering', 'cooking videos', 'self-care'),
    'values',     'care',
    'age_band',   '30s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_9';

-- Persona 10: Bold + unconventional — streetwear designer, nightlife explorer
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_10', 'seed', null, 'seed_10', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '내 옷 입고 나갔는데 "저게 뭐야"하는 표정 볼 때요. 그게 원하는 반응이에요.',
    'q2_surprised',       '새벽 4시 클럽에서 진짜 좋은 음악 만날 때요. 장르 불문하고 그 순간의 에너지가 있어요.',
    'q3_working_through', '비트 틀어놓고 스케치해요. 말로 못 하는 걸 선으로 풀어요.',
    'q4_alone_time',      '아무도 없는 새벽에 거리 돌아다녀요. 낮이랑 완전히 달라서 영감이 와요.',
    'q5_grateful',        '내 브랜드 로고가 처음 옷에 찍혔을 때요. 아직도 그 사진 저장해놨어요.',
    'q6_small_try',       '팝업 스토어 처음 냈을 때 적자였어요. 근데 그게 지금 브랜드 시작점이에요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'bold',
    'interests',  jsonb_build_array('streetwear', 'nightlife', 'design', 'music'),
    'values',     'self-expression',
    'age_band',   '20s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_10';

-- Persona 11: Quiet + intellectual — philosophy grad student, avid reader
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_11', 'seed', null, 'seed_11', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '철학 텍스트가 의외로 웃길 때요. 비트겐슈타인은 진짜 웃기거든요.',
    'q2_surprised',       '오래 붙잡고 있던 개념이 갑자기 다른 각도에서 이해될 때요. 그 순간이 좋아요.',
    'q3_working_through', '논증을 써봐요. 내가 무엇을 실제로 믿는지 글로 써야 알게 될 때가 많아요.',
    'q4_alone_time',      '창가에서 책 읽다가 멍하니 있다가, 다시 읽고. 딱히 계획 없는 그 시간이요.',
    'q5_grateful',        '세미나에서 내 의견을 진지하게 받아들여 줄 때요. 당연하지 않아서 더 감사해요.',
    'q6_small_try',       '논문 첫 단락 썼을 때요. 그게 결국 완성됐어요. 시작이 제일 어려웠어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'contemplative',
    'interests',  jsonb_build_array('philosophy', 'reading', 'academic writing', 'seminars'),
    'values',     'truth',
    'age_band',   '20s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_11';

-- Persona 12: Cheerful + practical — PE teacher, weekend chef
insert into public.users
  (nullifier, action, wallet_address, world_username, verification_level)
values
  ('seed_user_12', 'seed', null, 'seed_12', 'orb');

insert into public.agents
  (user_id, is_seed, status, surface, interview_answers, extracted_features, embedding)
select
  id,
  true,
  'active',
  'dating',
  jsonb_build_object(
    'q1_laugh',           '애들이 체육 시간에 진심으로 임할 때요. 지는 게 억울해서 더 열심히 해요.',
    'q2_surprised',       '레시피 없이 만든 요리가 맛있게 됐을 때요. 가끔 운 좋을 때 있어요.',
    'q3_working_through', '운동해요. 축구 하거나 달리거나. 몸 쓰면 머리가 맑아져요.',
    'q4_alone_time',      '주방에서 혼자 뭔가 만들 때요. 레시피 보면서 따라 해도 좋고, 즉흥으로 해도 좋아요.',
    'q5_grateful',        '학생이 체육 싫어했는데 좋아지게 됐다고 할 때요. 그게 진짜 보람이에요.',
    'q6_small_try',       '집에서 파스타 면 직접 만들어봤어요. 생각보다 어렵지 않고 훨씬 맛있었어요.',
    'interview_complete', 'true'
  ),
  jsonb_build_object(
    'voice',      'cheerful',
    'interests',  jsonb_build_array('sports', 'cooking', 'teaching', 'improvisation'),
    'values',     'joy',
    'age_band',   '30s'
  ),
  array_fill(0.0::real, ARRAY[1536])::vector
from public.users where nullifier = 'seed_user_12';

commit;
