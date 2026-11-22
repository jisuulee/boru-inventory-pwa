export const cloudOrigin = 'https://boru-inventory-pwa.smilingcheetah1.chatgpt.site'
export const isAccountId = value => typeof value === 'string' && value.trim().length > 0
export function cloudStore(account) {
  async function request(data) {
    let response
    try {
      response = await fetch(cloudOrigin + '/api/inventory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, ...data }), signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw Error('서버에 연결할 수 없어요. 인터넷 연결 후 다시 확인해 주세요.')
    }
    if (response.status === 409) throw Error('다른 기기에서 재고가 바뀌었어요. 다시 확인한 뒤 입력해 주세요.')
    if (response.status === 413) throw Error('저장할 수 있는 데이터 크기를 초과했어요.')
    if (!response.ok) throw Error('서버 저장소를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.')
    return response.json()
  }
  return async update => {
    const { state, revision } = await request({})
    if (!update) return state
    return (await request({ state: update(state), revision })).state
  }
}
