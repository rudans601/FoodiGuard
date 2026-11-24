// 19종 원료 사전. exclude는 해당 문자열만 가린다(문장 전체를 취소하지 않음).
// 출처와 모호한 식품유형의 처리 범위: docs/allergen-detection-prd.md
export const ALLERGEN_CODE_BY_LABEL = {
  난류: 'EGG',
  우유: 'MILK',
  메밀: 'BUCKWHEAT',
  땅콩: 'PEANUT',
  대두: 'SOY',
  밀: 'WHEAT',
  호두: 'WALNUT',
  잣: 'PINE_NUT',
  고등어: 'MACKEREL',
  게: 'CRAB',
  새우: 'SHRIMP',
  오징어: 'SQUID',
  조개류: 'SHELLFISH',
  돼지고기: 'PORK',
  닭고기: 'CHICKEN',
  쇠고기: 'BEEF',
  복숭아: 'PEACH',
  토마토: 'TOMATO',
  아황산류: 'SULFITES',
};

export const ALLERGEN_LABELS = Object.keys(ALLERGEN_CODE_BY_LABEL);

export const ALLERGEN_RULES = [
  {
    label: '난류',
    include: ['계란', '달걀', '난백', '난황', '전란', '난분', '액란', '메추리알',
      '알가열', '알가공품', '알함유', '오리알', '거위알', '칠면조알', '난류', '알류'],
    exclude: [],
  },
  {
    label: '우유',
    include: ['우유', '원유', '분유', '연유', '유크림', '생크림', '유청', '유장', '유당', '유지방',
      '유고형분', '유함유', '카제인', '카세인', '치즈', '버터', '발효유', '요구르트', '요거트',
      '밀크초콜릿'],
    exclude: ['무유당', '저유당', '땅콩버터', '피넛버터', '코코아버터', '카카오버터', '시어버터',
       '락토바실', '락토코커스', '락토올리고', '락툴로스'],
  },
  {
    label: '메밀',
    include: ['메밀', '모밀'],
    exclude: [],
  },
  {
    label: '땅콩',
    include: ['땅콩', '낙화생', '피넛'],
    exclude: ['토피넛'],
  },
  {
    label: '대두',
    include: ['대두', '두부', '두유', '된장', '청국장', '탈지대두', '비지', '백태', '서리태', '검정콩', '청태', '노란콩', '흑두'],
    exclude: ['두부류또는묵류'],
  },
  {
    label: '밀',
    include: ['밀', '소맥', '세몰리나', '듀럼', '박력분', '중력분', '강력분'],
    exclude: ['메밀', '모밀', '밀크밀', '밀크', '호밀', '밀랍', '밀웜', '아밀라', '밀리타리스'],
  },
  {
    label: '호두',
    include: ['호두'],
    exclude: [],
  },
  {
    label: '잣',
    include: ['잣'],
    exclude: [],
  },
  {
    label: '고등어',
    include: ['고등어'],
    exclude: [],
  },
  {
    label: '게',
    include: ['게'],
    exclude: ['스파게티', '말토게닉', '성게', '멍게', '게르마늄', '유게놀', '게라니', '게피'],
  },
  {
    label: '새우',
    include: ['새우', '대하'],
    exclude: [],
  },
  {
    label: '오징어',
    include: ['오징어'],
    exclude: [],
  },
  {
    label: '조개류',
    include: ['조개', '굴', '전복', '홍합', '바지락', '가리비', '소라', '재첩', '꼬막', '대합', '키조개'],
    exclude: ['덩굴', '둥굴', '굴비', '굴절', '소라비', '소라껍'],
  },
  {
    label: '돼지고기',
    include: ['돼지', '돈육', '돈지', '돈골', '돈피', '라드'],
    exclude: ['돼지감자'],
  },
  {
    label: '닭고기',
    include: ['닭', '계육'],
    exclude: ['불닭'],
  },
  {
    label: '쇠고기',
    include: ['쇠고기', '소고기', '우육', '우지', '소뼈', '우골', '한우', '소갈비', '소내장', '차돌'],
    exclude: ['염소고기', '염소갈비', '염소내장', '염소뼈'],
  },
  {
    label: '복숭아',
    include: ['복숭아', '황도', '백도'],
    exclude: [],
  },
  {
    label: '토마토',
    include: ['토마토'],
    exclude: ['나무토마토'],
  },
  {
    label: '아황산류',
    include: ['아황산', '이산화황', '차아황산', '메타중아황산', '산성아황산', '무수아황산'],
    exclude: [],
  },
];
