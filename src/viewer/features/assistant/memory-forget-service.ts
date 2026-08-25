export function isExplicitMemoryForgetRequest(value: string): boolean {
  const hasAction = /删除|删掉|移除|忘记|(?:不要|别|不再)\s*记住/u.test(value);
  const hasTargetCue = /记忆|这条|这个|喜欢|不喜欢|偏好|习惯|研究方向|项目|设置|内容|列表|残留|条目|记住|memory\.(?:search|list|forget)|工具/u.test(value);
  return hasAction && hasTargetCue;
}
