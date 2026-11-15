// LazyMotion이 나중에 불러오는 기능 묶음. layoutId(선택 표시가 미끄러지는 효과)가 있어 domMax를 쓴다.
// 별도 파일로 둔 이유: 첫 화면 번들에 넣지 않고 따로 받게 하려는 것이다.
export { domMax as default } from 'motion/react'
