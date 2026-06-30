// AI 사전 — 단축키(Alt+Q)/아이콘 클릭 시 현재 탭에 사전 오버레이(iframe)를 토글 주입한다.
//
// 왜 오버레이인가: 예전엔 action.default_popup(브라우저 액션 팝업)이었는데, 팝업 위치는 Chrome이
// 툴바 아이콘에 앵커해 결정한다. YouTube HTML5 전체화면처럼 툴바가 숨는 상황에선 앵커를 잃어
// 팝업이 왼쪽/화면 밖(특히 macOS는 상단 밖으로 입력창이 잘림)으로 튀어 위치 일관성이 없었다.
// 확장은 브라우저 액션 팝업의 좌표를 제어할 API가 없으므로, 페이지 내부에 직접 iframe을 주입해
// 위치를 우리가 제어한다. 전체화면 진입 시 fullscreenElement로 재부착해 영상 위에서도 같은 자리에 뜬다.
// (prior art: youtube_dual_subtitle — 플레이어 컨테이너 내부 마운트 + :fullscreen 보정)
//
// 권한: activeTab + scripting → 사용자가 단축키/아이콘을 누른 "그 탭"에만 그 순간 주입.
// 광범위 host 권한(<all_urls>) 없이 모든 사이트에서 동작(스토어 최소권한).

const POPUP_PATH = 'src/popup/index.html';
const POS_KEY = 'overlayPos'; // 드래그로 옮긴 위치(우측·상단 기준) 저장 키 — overlayBootstrap과 공유.

// default_popup이 없어 _execute_action(Alt+Q)·아이콘 클릭 모두 onClicked로 떨어진다 → 여기 하나로 처리.
chrome.action.onClicked.addListener((tab) => void toggle(tab));

async function toggle(tab?: chrome.tabs.Tab): Promise<void> {
  if (!tab?.id) return;
  const popupUrl = chrome.runtime.getURL(POPUP_PATH);
  const pos = ((await chrome.storage.local.get(POS_KEY))[POS_KEY] ?? null) as OverlayPos | null;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: overlayBootstrap,
      args: [popupUrl, pos, POS_KEY],
    });
  } catch {
    // chrome:// · 크롬 웹스토어 · PDF 뷰어 등 콘텐츠 스크립트가 금지된 페이지 → 작은 팝업 창으로 폴백.
    await chrome.windows.create({ url: popupUrl, type: 'popup', width: 460, height: 660 });
  }
}

interface OverlayPos {
  right: number;
  top: number;
}

// 페이지에 주입되는 부트스트랩. executeScript({func})는 이 함수를 직렬화(func.toString())해 넣으므로
// 반드시 자기완결적이어야 한다 — 인자(popupUrl/pos/posKey)와 전역(document/window/chrome)만 참조하고
// 외부 모듈 함수·변수는 참조 금지(번들 후 toString에 안 담겨 ReferenceError 난다).
function overlayBootstrap(popupUrl: string, pos: OverlayPos | null, posKey: string): void {
  const HOST_ID = 'ai-dict-overlay-host';

  // 토글: 이미 떠 있으면 닫는다. (self-prune 리스너들이 host.isConnected로 알아서 정리됨)
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const WIDTH = 432;
  const right = pos ? pos.right : 16;
  const top = pos ? pos.top : 16;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position:fixed',
    `top:${top}px`,
    `right:${right}px`,
    `width:${WIDTH}px`,
    'max-height:calc(100vh - 16px)', // 높이는 iframe 내용에 맞춰 가변(아래 ai-dict-height) — 화면 높이로만 상한.
    'z-index:2147483647',
    'display:flex',
    'flex-direction:column',
    'border:1px solid #3a3d44',
    'border-radius:10px',
    'overflow:hidden',
    'box-shadow:0 8px 30px rgba(0,0,0,0.45)',
    'background:#1e1f24',
    'color-scheme:dark',
    // 독립 GPU 합성 레이어로 승격 — 답변 페인트가 그 아래 재생 중 영상 레이어 재페인트를 안 건드리게(버벅임 완화).
    'transform:translateZ(0)',
    'will-change:transform',
  ].join(';');

  // 드래그 핸들 + 닫기 — iframe 위에선 포인터 이벤트가 iframe로 먹히므로, 핸들은 부모(host)에 둔다.
  const bar = document.createElement('div');
  bar.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'padding:4px 6px 4px 10px',
    'cursor:move',
    'user-select:none',
    'background:#2a2d33',
    'color:#9aa0a8',
    'font:12px -apple-system,BlinkMacSystemFont,system-ui,sans-serif',
    'flex:0 0 auto',
  ].join(';');
  const title = document.createElement('span');
  title.textContent = 'AI 사전';
  const cornerBtnCss =
    'background:none;border:none;color:#9aa0a8;font-size:14px;line-height:1;cursor:pointer;padding:2px 6px';
  // – 최소화: 패널을 📖 아이콘으로 접는다(iframe은 DOM에 살려둬 세션·스크롤·입력 보존 → 즉시 복원).
  const minBtn = document.createElement('button');
  minBtn.textContent = '–';
  minBtn.title = '최소화';
  minBtn.style.cssText = cornerBtnCss;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = '닫기 (Esc)';
  closeBtn.style.cssText = cornerBtnCss;
  closeBtn.addEventListener('click', () => host.remove());
  const corner = document.createElement('span');
  corner.style.cssText = 'display:flex;align-items:center;flex:0 0 auto';
  corner.append(minBtn, closeBtn);
  bar.append(title, corner);

  const frame = document.createElement('iframe');
  frame.src = popupUrl;
  frame.allow = 'clipboard-write';
  // 높이는 팝업이 보내는 ai-dict-height로 맞춘다. 로드 전 초깃값은 입력+버튼이 안 잘리는 값(짧게 시작).
  frame.style.cssText = 'flex:0 0 auto;width:100%;height:150px;border:none;background:#1e1f24';

  // 최소화 시 보이는 📖 아이콘 — 평소 숨김. 클릭하면 패널 복원.
  const miniIcon = document.createElement('div');
  miniIcon.textContent = '📖';
  miniIcon.title = 'AI 사전 펼치기';
  miniIcon.style.cssText = [
    'display:none',
    'align-items:center',
    'justify-content:center',
    'width:36px',
    'height:36px',
    'font-size:20px',
    'cursor:pointer',
    'user-select:none',
  ].join(';');

  host.append(bar, frame, miniIcon);
  document.body.appendChild(host);

  // 최소화/복원 — host를 살려둔 채 내용물만 토글(iframe 유지 → 세션·스크롤·입력 보존).
  const setMinimized = (min: boolean): void => {
    bar.style.display = min ? 'none' : 'flex';
    frame.style.display = min ? 'none' : '';
    miniIcon.style.display = min ? 'flex' : 'none';
    host.style.width = min ? 'auto' : `${WIDTH}px`;
    host.style.maxHeight = min ? 'none' : 'calc(100vh - 16px)';
  };
  minBtn.addEventListener('click', () => setMinimized(true));
  // miniIcon의 복원 클릭은 드래그와 구분해야 하므로(아래 moved) 드래그 섹션 뒤에서 등록한다.

  // 포커스를 iframe으로 넘겨 팝업 내부 input.focus()가 먹히게.
  setTimeout(() => frame.focus(), 50);

  // ----- 드래그 이동 (헤더 바 + 최소화 아이콘, 우측·상단 기준 좌표 유지) -----
  // 아이콘은 클릭=복원도 겸하므로, 4px 이상 움직였을 때만 드래그로 보고(moved) 그 클릭은 무시한다.
  let dragging = false;
  let moved = false;
  let sx = 0;
  let sy = 0;
  let sRight = right;
  let sTop = top;
  const startDrag = (e: MouseEvent): void => {
    dragging = true;
    moved = false;
    sx = e.clientX;
    sy = e.clientY;
    sRight = parseFloat(host.style.right) || 0;
    sTop = parseFloat(host.style.top) || 0;
    e.preventDefault();
  };
  bar.addEventListener('mousedown', startDrag);
  miniIcon.addEventListener('mousedown', startDrag);
  const onMove = (e: MouseEvent) => {
    if (!host.isConnected) return void window.removeEventListener('mousemove', onMove);
    if (!dragging) return;
    if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 4) return; // 미세 떨림은 클릭으로
    moved = true;
    host.style.right = `${Math.max(0, sRight - (e.clientX - sx))}px`;
    host.style.top = `${Math.max(0, sTop + (e.clientY - sy))}px`;
  };
  const onUp = () => {
    if (!host.isConnected) return void window.removeEventListener('mouseup', onUp);
    if (!dragging) return;
    dragging = false;
    if (!moved) return; // 안 움직였으면 클릭 → 위치 저장 불필요(아이콘 클릭 핸들러가 복원 처리)
    try {
      chrome.storage.local.set({
        [posKey]: { right: parseFloat(host.style.right) || 0, top: parseFloat(host.style.top) || 0 },
      });
    } catch {
      /* storage 접근 불가 시 위치 저장만 생략 */
    }
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  // 미니 아이콘: 끌었으면(moved) 복원하지 않고, 제자리 클릭일 때만 펼친다.
  miniIcon.addEventListener('click', () => {
    if (!moved) setMinimized(false);
  });

  // ----- 전체화면 대응 -----
  // fixed 요소라도 fullscreenElement 서브트리 밖이면 전체화면 중엔 가려진다(YouTube 전체화면이 대표).
  // 진입 시 fullscreenElement 안으로, 해제 시 body로 재부착해 항상 같은 자리(오른쪽)에 보이게 한다.
  const reparent = () => {
    if (!host.isConnected) return void document.removeEventListener('fullscreenchange', reparent);
    const fs = document.fullscreenElement;
    const target = fs && fs !== host && !fs.contains(host) ? fs : document.body;
    if (host.parentElement !== target) target.appendChild(host);
  };
  document.addEventListener('fullscreenchange', reparent);
  reparent(); // 이미 전체화면 상태에서 열었을 수도 있으니 1회 보정.

  // ----- iframe(팝업) → 부모 메시지: Esc 닫기 / 내용 높이 반영 -----
  const onMsg = (e: MessageEvent) => {
    if (!host.isConnected) return void window.removeEventListener('message', onMsg);
    if (e.source !== frame.contentWindow) return;
    const d = e.data as string | { type?: string; height?: number };
    if (d === 'ai-dict-close') {
      host.remove();
    } else if (d && typeof d === 'object' && d.type === 'ai-dict-height' && typeof d.height === 'number') {
      const barH = bar.offsetHeight || 28;
      const max = window.innerHeight - 16 - barH; // 화면 밖으로 안 넘치게 상한.
      frame.style.height = `${Math.max(80, Math.min(d.height, max))}px`;
    }
  };
  window.addEventListener('message', onMsg);
}
