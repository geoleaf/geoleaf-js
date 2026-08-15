/*!
 * @geoleaf-plugins/connector v1.2.5
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
var we=Object.defineProperty,ye=Object.defineProperties;var ke=Object.getOwnPropertyDescriptors;var H=Object.getOwnPropertySymbols;var xe=Object.prototype.hasOwnProperty,Ce=Object.prototype.propertyIsEnumerable;var W=(e,t,n)=>t in e?we(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,S=(e,t)=>{for(var n in t||(t={}))xe.call(t,n)&&W(e,n,t[n]);if(H)for(var n of H(t))Ce.call(t,n)&&W(e,n,t[n]);return e},L=(e,t)=>ye(e,ke(t));var s=(e,t,n)=>new Promise((o,r)=>{var a=c=>{try{u(n.next(c))}catch(l){r(l)}},i=c=>{try{u(n.throw(c))}catch(l){r(l)}},u=c=>c.done?o(c.value):Promise.resolve(c.value).then(a,i);u((n=n.apply(e,t)).next())});var he,I,ge,be,ve;const Ee="geoleaf-connector",Tt=1,w="auth-tokens",y=new Map;let B=null;const F=new Map;function O(){return new Promise((e,t)=>{const n=indexedDB.open(Ee,1);n.onupgradeneeded=o=>{const r=o.target.result;r.objectStoreNames.contains(w)||r.createObjectStore(w,{keyPath:"baseUrl"})},n.onsuccess=o=>e(o.target.result),n.onerror=o=>{var r;return t((r=o.target.error)!=null?r:new Error("IDB open failed"))}})}function $(e){return s(this,null,function*(){try{const t=yield O();return new Promise((n,o)=>{const r=t.transaction(w,"readonly"),a=r.objectStore(w).get(e);a.onsuccess=()=>{var i;return n((i=a.result)!=null?i:null)},a.onerror=()=>{var i;return o((i=a.error)!=null?i:new Error("IDB get failed"))},r.oncomplete=()=>t.close()})}catch(t){return null}})}function Ae(e){return s(this,null,function*(){try{const t=yield O();yield new Promise((n,o)=>{const r=t.transaction(w,"readwrite"),a=r.objectStore(w).put(e);a.onsuccess=()=>n(),a.onerror=()=>{var i;return o((i=a.error)!=null?i:new Error("IDB put failed"))},r.oncomplete=()=>t.close()})}catch(t){}})}function Se(e){return s(this,null,function*(){try{const t=yield O();yield new Promise((n,o)=>{const r=t.transaction(w,"readwrite"),a=r.objectStore(w).delete(e);a.onsuccess=()=>n(),a.onerror=()=>{var i;return o((i=a.error)!=null?i:new Error("IDB delete failed"))},r.oncomplete=()=>t.close()})}catch(t){}})}function Le(e,t,n){return s(this,null,function*(){y.set(e,{token:t,expiresAt:n}),yield Ae({baseUrl:e,token:t,expiresAt:n})})}function _e(e){return s(this,null,function*(){const t=y.get(e);if(t)return t;const n=yield $(e);return n?(y.set(e,{token:n.token,expiresAt:n.expiresAt}),{token:n.token,expiresAt:n.expiresAt}):null})}function Te(e){return s(this,null,function*(){y.delete(e),yield Se(e)})}function Ue(e){const t=y.get(e);return t?t.expiresAt<=Date.now()?(y.delete(e),null):t.token:null}function Pe(e){return s(this,null,function*(){if(!B)return null;try{return yield B(e)}catch(t){return typeof document!="undefined"&&document.dispatchEvent(new CustomEvent("geoleaf:connector:auth-error",{detail:{baseUrl:e,error:t instanceof Error?t.message:String(t)}})),null}})}function z(e){return s(this,null,function*(){const t=F.get(e);if(t!==void 0)return t;const n=Pe(e).finally(()=>F.delete(e));return F.set(e,n),n})}function Ie(e){return s(this,null,function*(){const t=Date.now(),n=y.get(e);if(n&&n.expiresAt>t+3e4)return n.expiresAt-t<3e5&&z(e).catch(()=>{}),n.token;const o=yield $(e);return o&&o.expiresAt>t+3e4?(y.set(e,{token:o.token,expiresAt:o.expiresAt}),o.expiresAt-t<3e5&&z(e).catch(()=>{}),o.token):o||n?z(e):null})}const f={save:Le,load:_e,clear:Te,getTokenSync:Ue,getTokenAsync:Ie,_setRefreshFn(e){B=e}};var Be=Object.defineProperty,Fe=Object.defineProperties,Oe=Object.getOwnPropertyDescriptors,K=Object.getOwnPropertySymbols,ze=Object.prototype.hasOwnProperty,De=Object.prototype.propertyIsEnumerable,D=(e,t,n)=>t in e?Be(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,Ne=(e,t)=>{for(var n in t||(t={}))ze.call(t,n)&&D(e,n,t[n]);if(K)for(var n of K(t))De.call(t,n)&&D(e,n,t[n]);return e},Me=(e,t)=>Fe(e,Oe(t)),qe=(e,t,n)=>D(e,t+"",n),Ge=(e,t,n)=>new Promise((o,r)=>{var a=c=>{try{u(n.next(c))}catch(l){r(l)}},i=c=>{try{u(n.throw(c))}catch(l){r(l)}},u=c=>c.done?o(c.value):Promise.resolve(c.value).then(a,i);u((n=n.apply(e,t)).next())});function Re(){var e;return(e=globalThis.GeoLeaf)==null?void 0:e.I18n}function p(e,t){var n,o;const r=(o=(n=Re())==null?void 0:n.getLabel)==null?void 0:o.call(n,e);return typeof r=="string"&&r.length>0&&r!==e?r:t!=null?t:e}const J=new Set;function X(e,t){if(!J.has(t))try{const n=new CSSStyleSheet;n.replaceSync(e),document.adoptedStyleSheets=[...document.adoptedStyleSheets,n],J.add(t)}catch(n){}}var je="/*! @geoleaf/host-runtime \u2014 \xA9 2026 Mattieu Pottier \u2014 MIT License */.gl-tooltip{background:var(--gl-color-tooltip-bg,rgba(0,0,0,.78));border-radius:9999px;color:var(--gl-color-tooltip-text,#fff);font-size:.72rem;font-weight:500;line-height:1.4;opacity:0;padding:4px 10px;pointer-events:none;position:fixed;transform:translateY(-50%);transition:opacity .15s ease;white-space:nowrap;z-index:1010}.gl-tooltip.gl-is-visible{opacity:1}@media (prefers-reduced-motion:reduce){.gl-tooltip{transition:none}}";try{var Y=new CSSStyleSheet;Y.replaceSync(je),document.adoptedStyleSheets=[...document.adoptedStyleSheets,Y]}catch(e){}function Q(e={}){const t={"Content-Type":"application/json"};return e.authorization&&(t.Authorization=e.authorization),e.force&&(t["X-Force-Update"]="true"),t}function U(e){return`Bearer ${e}`}class N extends Error{constructor(t,n,o){super(n),qe(this,"kind"),this.name="HttpFetchError",this.kind=t,(o==null?void 0:o.cause)!==void 0&&(this.cause=o.cause)}}function Z(e,t,n,o){return Ge(this,null,function*(){if(typeof e!="function")throw new N("network","fetch is not available");const r=new AbortController,a=setTimeout(()=>r.abort(),o);try{return yield e(t,Me(Ne({},n),{signal:r.signal}))}catch(i){throw r.signal.aborted?new N("timeout","request timed out",{cause:i}):new N("network","network request failed",{cause:i})}finally{clearTimeout(a)}})}class k extends Error{constructor(t){super(t),this.name="AuthError"}}function ee(e){return s(this,null,function*(){if(e.status===401)throw new k("Invalid credentials");if(e.status===404)throw new k("Endpoint not found (404)");if(e.status>=500)throw new k("Server error ("+e.status+")");if(!e.ok)throw new k("Authentication failed ("+e.status+")");let t;try{t=yield e.json()}catch(n){throw new k("Invalid server response: could not parse JSON")}if(!t.token||typeof t.expiresIn!="number")throw new k("Invalid server response: missing token or expiresIn");return t})}const te={login(e,t,n){return s(this,null,function*(){let o=n;try{let r;try{r=yield Z(fetch,e,{method:"POST",headers:Q(),body:JSON.stringify({login:t,password:o})},15e3)}catch(a){throw new k("Network unavailable")}return yield ee(r)}finally{o=""}})},refresh(e,t){return s(this,null,function*(){let n;try{n=yield Z(fetch,`${e}/refresh`,{method:"POST",headers:Q({authorization:U(t)})},15e3)}catch(o){return null}if(n.status===404)return null;try{return yield ee(n)}catch(o){return null}})}};const Ve=`
.gc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  font-family: system-ui, -apple-system, sans-serif;
}
.gc-modal {
  position: relative;
  background: var(--gl-color-bg-surface, #ffffff);
  color: var(--gl-color-text-main, #0f172a);
  border: 1px solid var(--gl-color-border-soft, rgba(15,23,42,0.08));
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.24);
  padding: 2rem;
  width: 100%;
  max-width: 360px;
  box-sizing: border-box;
}
.gc-modal h2 {
  margin: 0 0 1.25rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--gl-color-text-main, #0f172a);
}
.gc-modal label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--gl-color-text-muted, #374151);
}
.gc-modal input {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-bottom: 1rem;
  background: var(--gl-color-bg-surface-muted, #f9fafb);
  color: var(--gl-color-text-main, #0f172a);
  border: 1px solid var(--gl-color-border-strong, rgba(15,23,42,0.22));
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.gc-modal input::placeholder {
  color: var(--gl-color-text-muted, #9ca3af);
  opacity: 0.7;
}
.gc-modal input:focus {
  border-color: var(--gl-color-accent, #3b82f6);
  box-shadow: 0 0 0 2px var(--gl-color-accent-soft, rgba(59,130,246,0.25));
}
.gc-modal button[type="submit"] {
  width: 100%;
  padding: 0.625rem 1rem;
  background: var(--gl-color-accent, #3b82f6);
  color: var(--gl-color-accent-contrast, #ffffff);
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.gc-modal button[type="submit"]:hover:not(:disabled) {
  background: var(--gl-color-accent-hover, #2563eb);
}
.gc-modal button[type="submit"]:disabled {
  background: var(--gl-color-accent-soft, #93c5fd);
  color: var(--gl-color-text-muted, #ffffff);
  cursor: not-allowed;
}
.gc-error {
  color: #dc2626;
  font-size: 0.875rem;
  margin: 0 0 0.75rem;
  min-height: 1.25em;
}
.gc-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--gl-color-text-muted, #6b7280);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}
.gc-close:hover {
  background: var(--gl-color-bg-surface-muted, #f3f4f6);
  color: var(--gl-color-text-main, #111);
}
.gc-close:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 1px;
}
.gc-links {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--gl-color-border-soft, rgba(15,23,42,0.08));
  font-size: 0.875rem;
  color: var(--gl-color-text-muted, #6b7280);
}
.gc-links a {
  color: var(--gl-color-accent, #3b82f6);
  text-decoration: none;
}
.gc-links a:hover { text-decoration: underline; }
.gc-links a:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 2px;
  border-radius: 2px;
}
`,He="input:not([disabled]), button:not([disabled]), a[href]:not([hidden])";function We(e){return t=>{if(t.key!=="Tab")return;const n=Array.from(e.querySelectorAll(He)),o=n[0],r=n.at(-1);!o||!r||(t.shiftKey?document.activeElement===o&&(t.preventDefault(),r.focus()):document.activeElement===r&&(t.preventDefault(),o.focus()))}}function $e(){const e="http://www.w3.org/2000/svg",t=document.createElementNS(e,"svg");t.setAttribute("width","16"),t.setAttribute("height","16"),t.setAttribute("viewBox","0 0 24 24"),t.setAttribute("fill","none"),t.setAttribute("stroke","currentColor"),t.setAttribute("stroke-width","2"),t.setAttribute("stroke-linecap","round"),t.setAttribute("stroke-linejoin","round"),t.setAttribute("aria-hidden","true");const n=document.createElementNS(e,"path");return n.setAttribute("d","M18 6L6 18M6 6l12 12"),t.appendChild(n),t}function Ke(){X(Ve,"gc-style");const e=document.createElement("div");e.className="gc-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-labelledby","gc-modal-title");const t=document.createElement("div");t.className="gc-modal";const n=document.createElement("button");n.type="button",n.className="gc-close",n.setAttribute("aria-label",p("connector.modal.close","Fermer")),n.appendChild($e());const o=document.createElement("h2");o.id="gc-modal-title",o.textContent=p("connector.modal.title","Connexion");const r=document.createElement("form");r.id="gc-login-form",r.setAttribute("novalidate","");const a=document.createElement("label");a.setAttribute("for","gc-login"),a.textContent=p("connector.modal.loginLabel","Identifiant");const i=document.createElement("input");i.id="gc-login",i.type="text",i.setAttribute("autocomplete","username"),i.required=!0;const u=document.createElement("label");u.setAttribute("for","gc-password"),u.textContent=p("connector.modal.passwordLabel","Mot de passe");const c=document.createElement("input");c.id="gc-password",c.type="password",c.setAttribute("autocomplete","current-password"),c.required=!0;const l=document.createElement("p");l.id="gc-error",l.className="gc-error",l.setAttribute("role","alert"),l.setAttribute("aria-live","polite"),l.hidden=!0;const A=document.createElement("button");A.type="submit",A.textContent=p("connector.modal.submit","Se connecter"),r.appendChild(a),r.appendChild(i),r.appendChild(u),r.appendChild(c),r.appendChild(l),r.appendChild(A);const d=document.createElement("div");d.className="gc-links",d.hidden=!0;const g=document.createElement("a");g.id="gc-link-signup",g.textContent=p("connector.modal.signup","Cr\xE9er un compte"),g.target="_blank",g.rel="noopener noreferrer",g.hidden=!0;const b=document.createElement("a");return b.id="gc-link-forgot",b.textContent=p("connector.modal.forgot","Mot de passe oubli\xE9"),b.target="_blank",b.rel="noopener noreferrer",b.hidden=!0,d.appendChild(g),d.appendChild(b),t.appendChild(n),t.appendChild(o),t.appendChild(r),t.appendChild(d),e.appendChild(t),{overlay:e,closeBtn:n,loginInput:i,passwordInput:c,submitBtn:A,errorEl:l,form:r,linksDiv:d,signupLink:g,forgotLink:b}}function Je(e,t){var n,o;(n=t.auth)!=null&&n.signupUrl&&(e.signupLink.href=t.auth.signupUrl,e.signupLink.hidden=!1,e.linksDiv.hidden=!1),(o=t.auth)!=null&&o.forgotPasswordUrl&&(e.forgotLink.href=t.auth.forgotPasswordUrl,e.forgotLink.hidden=!1,e.linksDiv.hidden=!1),e.signupLink.addEventListener("click",r=>{const a=new CustomEvent("geoleaf:connector:signup-requested",{detail:{url:t.auth.signupUrl},cancelable:!0});document.dispatchEvent(a)||r.preventDefault()}),e.forgotLink.addEventListener("click",r=>{const a=new CustomEvent("geoleaf:connector:forgot-password-requested",{detail:{url:t.auth.forgotPasswordUrl},cancelable:!0});document.dispatchEvent(a)||r.preventDefault()})}function Xe(e,t,n){const o=()=>{t(),n(new Error("Modal closed by user"))},r=a=>{a.key==="Escape"&&o()};return document.addEventListener("keydown",r),e.closeBtn.addEventListener("click",o),e.overlay.addEventListener("click",a=>{a.target===e.overlay&&o()}),r}function Ye(e,t,n,o){const r=c=>{e.errorEl.textContent=c,e.errorEl.hidden=!1},a=()=>{e.errorEl.textContent="",e.errorEl.hidden=!0},i=c=>{e.submitBtn.disabled=c,e.loginInput.disabled=c,e.passwordInput.disabled=c,e.submitBtn.textContent=c?p("connector.modal.submitting","Connexion\u2026"):p("connector.modal.submit","Se connecter")};e.form.addEventListener("submit",c=>{u(c)});function u(c){return s(this,null,function*(){c.preventDefault(),a();const l=e.loginInput.value.trim(),A=e.passwordInput.value;if(!l||!A){r(p("connector.error.emptyFields","Veuillez remplir tous les champs."));return}i(!0);try{const d=t.auth;if(!(d!=null&&d.endpoint)){r(p("connector.error.noEndpoint","Configuration invalide : endpoint manquant.")),i(!1);return}const g=yield te.login(d.endpoint,l,A),b=Date.now()+g.expiresIn*1e3;yield f.save(t.baseUrl,g.token,b),n(),document.dispatchEvent(new CustomEvent("geoleaf:connector:authenticated",{detail:{baseUrl:t.baseUrl}})),o()}catch(d){i(!1),e.passwordInput.value="",d instanceof k?d.message==="Invalid credentials"?r(p("connector.error.invalidCredentials","Identifiant ou mot de passe incorrect.")):d.message==="Network unavailable"?r(p("connector.error.networkUnavailable","Serveur inaccessible. V\xE9rifiez votre connexion.")):r(p("connector.error.generic","Erreur : ")+d.message):r(p("connector.error.unexpected","Une erreur inattendue est survenue."))}})}}function M(e){return new Promise((t,n)=>{const o=Ke();Je(o,e);const r=We(o.overlay);document.addEventListener("keydown",r);const a=()=>{document.removeEventListener("keydown",r),document.removeEventListener("keydown",i),o.overlay.remove()},i=Xe(o,a,n);Ye(o,e,a,t),document.body.appendChild(o.overlay),requestAnimationFrame(()=>o.loginInput.focus())})}const Qe=`
.gc-credential-separator {
  height: 1px;
  background: var(--gl-color-border-soft, rgba(15,23,42,0.08));
  margin: 8px 4px 8px;
  width: calc(100% - 8px);
  flex-shrink: 0;
}
.gc-credential-btn[data-variant="desktop"] {
  margin-bottom: 8px;
  flex-shrink: 0;
}
/* Hide the mobile-variant button on desktop (\u2265 1440px) \u2014 core breakpoint
   where .gl-rp-tabs becomes the primary surface and the mobile pill still
   exists but several of its buttons are already hidden by the core. */
@media (min-width: 1440px) {
  .gc-credential-btn[data-variant="mobile"] {
    display: none !important;
  }
}
.gc-credential-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  margin: 4px auto;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--gl-color-text-muted, #6b7280);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.gc-credential-btn:hover {
  background: color-mix(in srgb, var(--gl-color-accent, #f97316) 15%, transparent);
  color: var(--gl-color-accent, #f97316);
}
.gc-credential-btn:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 2px;
}
`;let h=null,x=null,C=null,q=!1;function Ze(e){var i,u,c,l;if(((u=(i=e.auth)==null?void 0:i.credentialButton)==null?void 0:u.enabled)===!0)return!0;const n=globalThis.GeoLeaf,o=n==null?void 0:n.Config,r=(c=o==null?void 0:o.getActiveProfile)==null?void 0:c.call(o),a=(l=r==null?void 0:r.ui)!=null?l:void 0;return(a==null?void 0:a.showCredentialButton)===!0}function et(){q||(X(Qe,"gc-btn-style"),q=!0)}function tt(e){const t="http://www.w3.org/2000/svg",n=document.createElementNS(t,"svg");if(n.setAttribute("width","18"),n.setAttribute("height","18"),n.setAttribute("viewBox","0 0 24 24"),n.setAttribute("fill","none"),n.setAttribute("stroke","currentColor"),n.setAttribute("stroke-width","2"),n.setAttribute("stroke-linecap","round"),n.setAttribute("stroke-linejoin","round"),n.setAttribute("aria-hidden","true"),e==="user"){const o=document.createElementNS(t,"circle");o.setAttribute("cx","12"),o.setAttribute("cy","8"),o.setAttribute("r","4"),n.appendChild(o);const r=document.createElementNS(t,"path");r.setAttribute("d","M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"),n.appendChild(r)}else{const o=document.createElementNS(t,"rect");o.setAttribute("x","5"),o.setAttribute("y","11"),o.setAttribute("width","14"),o.setAttribute("height","10"),o.setAttribute("rx","2"),n.appendChild(o);const r=document.createElementNS(t,"path");r.setAttribute("d","M8 11V7a4 4 0 0 1 8 0v4"),n.appendChild(r)}return n}function ne(e,t){var a,i,u;const n=document.createElement("button");n.type="button",n.className="gc-credential-btn",n.dataset.variant=t;const o=(u=(i=(a=e.auth)==null?void 0:a.credentialButton)==null?void 0:i.iconVariant)!=null?u:"lock",r=tt(o==="user"?"user":"lock");return n.appendChild(r),n.addEventListener("click",()=>{nt(e)}),n}function nt(e){return s(this,null,function*(){var r,a;const o=!!(!!((a=(r=e.auth)==null?void 0:r.endpoint)!=null&&a.trim())?yield f.getTokenAsync(e.baseUrl):null);if(document.dispatchEvent(new CustomEvent("geoleaf:connector:credential-button-clicked",{detail:{baseUrl:e.baseUrl,authenticated:o}})),!o)try{yield M(e)}catch(i){}})}function ot(e){const t=document.querySelector(".gl-rp-tabs");if(!t||t.querySelector(".gc-credential-btn"))return;const n=document.createElement("div");n.className="gc-credential-separator";const o=ne(e,"desktop");o.setAttribute("aria-label","Connexion"),o.title="Connexion",t.appendChild(n),t.appendChild(o),x=o}function rt(e){var o;const t=(o=document.querySelector(".gl-map-toolbar__scroll"))!=null?o:document.querySelector(".gl-map-toolbar");if(!t||t.querySelector(".gc-credential-btn"))return;const n=ne(e,"mobile");n.classList.add("gl-map-toolbar__btn"),n.setAttribute("aria-label","Connexion"),t.appendChild(n),C=n}function oe(e){x||ot(e),C||rt(e),x&&C&&(h==null||h.disconnect())}function re(e){Ze(e)&&(et(),oe(e),(!x||!C)&&(h=new MutationObserver(()=>oe(e)),h.observe(document.body,{childList:!0,subtree:!0}),setTimeout(()=>h==null?void 0:h.disconnect(),1e4)))}function at(){h==null||h.disconnect(),h=null,x==null||x.remove(),C==null||C.remove(),x=null,C=null,q=!1}class v extends Error{constructor(t){super(t),this.name="ConfigError"}}function ae(e){var t,n;it(e),ct(e),ce((t=e.auth)==null?void 0:t.signupUrl,"auth.signupUrl"),ce((n=e.auth)==null?void 0:n.forgotPasswordUrl,"auth.forgotPasswordUrl"),st(e)}function ie(){return typeof location!="undefined"&&(location.hostname==="localhost"||location.hostname==="127.0.0.1")}function it(e){if(!e||typeof e.baseUrl!="string"||!e.baseUrl.trim())throw new v("[GeoLeaf Connector] baseUrl must be a non-empty string.");if(!e.baseUrl.startsWith("https://"))if(ie())console.warn("[GeoLeaf Connector] baseUrl should use HTTPS in production. Current value: "+e.baseUrl);else throw new v("[GeoLeaf Connector] baseUrl must use HTTPS in production. Received: "+e.baseUrl)}function ct(e){var o,r;const t=typeof e.getToken=="function",n=e.auth!==void 0&&e.auth!==null;if(!t&&!n)throw new v("[GeoLeaf Connector] Either getToken or auth must be provided.");if(t&&n)throw new v("[GeoLeaf Connector] getToken and auth are mutually exclusive. Provide only one.");if(n&&!((r=(o=e.auth)==null?void 0:o.endpoint)!=null&&r.trim()))throw new v("[GeoLeaf Connector] auth.endpoint must be a non-empty string when auth is configured.")}function st(e){var t,n;(n=(t=e.auth)==null?void 0:t.credentialButton)!=null&&n.iconVariant&&e.auth.credentialButton.iconVariant!=="lock"&&e.auth.credentialButton.iconVariant!=="user"&&(e.auth.credentialButton.iconVariant="lock")}function ce(e,t){if(e!=null){if(typeof e!="string"||!e.trim())throw new v(`[GeoLeaf Connector] ${t} must be a non-empty string when provided.`);if(!e.startsWith("https://"))if(ie())console.warn(`[GeoLeaf Connector] ${t} should use HTTPS in production. Current value: ${e}`);else throw new v(`[GeoLeaf Connector] ${t} must use HTTPS in production. Received: ${e}`)}}function lt(e,t){const[n=""]=e.toLowerCase().split("?");return n.endsWith(".fgb")?"flatgeobuf":n.endsWith(".kml")?"kml":n.endsWith(".csv")?"csv":n.endsWith(".pmtiles")?"pmtiles":n.endsWith(".mvt")||n.endsWith(".pbf")?"mvt":n.includes("/collections/")?"oapif":"geojson"}const P=globalThis.fetch;let m=null;function ut(e){return typeof e=="string"?e:e instanceof URL?e.href:e instanceof Request?e.url:""}function se(e,t){var n,o;try{const r=new URL(e,(n=globalThis.location)==null?void 0:n.href),a=new URL(t,(o=globalThis.location)==null?void 0:o.href);if(r.origin!==a.origin)return!1;const i=a.pathname.replace(/\/+$/,"");return i===""?!0:r.pathname===i||r.pathname.startsWith(`${i}/`)}catch(r){return!1}}function dt(e){if(!m||!se(e,m.baseUrl))return!1;const t=lt(e);return t!=="pmtiles"&&t!=="mvt"}function ft(){return s(this,null,function*(){return m?m.getToken?m.getToken():f.getTokenAsync(m.baseUrl):null})}function pt(e,t){return s(this,null,function*(){if(!m)return new Response(null,{status:401,statusText:"Unauthorized"});let n=null;try{m.getToken?n=yield Promise.resolve(m.getToken()):(yield f.clear(m.baseUrl),n=yield f.getTokenAsync(m.baseUrl))}catch(o){}if(n){const o=L(S({},t.headers),{Authorization:U(n)});return P(e,L(S({},t),{headers:o}))}return typeof document!="undefined"&&document.dispatchEvent(new CustomEvent("geoleaf:connector:auth-error",{detail:{baseUrl:m.baseUrl,error:"Authentication failed \u2014 401 after token refresh attempt."}})),new Response(null,{status:401,statusText:"Unauthorized"})})}function mt(e){if(m=e,globalThis.fetch=function(o){return s(this,arguments,function*(t,n={}){const r=ut(t);if(dt(r)){const a=yield ft();a&&(n=L(S({},n),{headers:L(S({},n.headers),{Authorization:U(a)})}));const i=yield P(t,n);return i.status===401?pt(t,n):i}return P(t,n)})},e.getToken){const t=e.getToken(),n=o=>{o&&!o.includes(".")&&console.warn("[GeoLeaf Connector] Static token detected. This provides NO real security \u2014 use only for dev/demo with non-sensitive data.")};t instanceof Promise?t.then(n).catch(()=>{}):n(t)}}function ht(){globalThis.fetch=P,delete globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__,m=null}function gt(e,t){if(!se(e,t))return;const n=f.getTokenSync(t);if(n)return{Authorization:U(n)}}function le(e){return e!=null&&typeof e.setTransformRequest=="function"}function G(){const t=globalThis.GeoLeaf;if(!t)return null;const n=t.Core;if(!n||typeof n.getMap!="function")return null;const o=n.getMap();return!o||typeof o.getNativeMap!="function"?null:o.getNativeMap()}function R(e,t){return le(e)?(e.setTransformRequest(n=>{if(!n.startsWith(t.baseUrl))return;const o=f.getTokenSync(t.baseUrl);if(f.getTokenAsync(t.baseUrl).catch(()=>{}),!!o)return{url:n,headers:{Authorization:`Bearer ${o}`}}}),!0):!1}function ue(e){typeof document!="undefined"&&document.addEventListener("geoleaf:basemap:change",t=>{const n=t.detail,o=n==null?void 0:n.map,r=le(o)?o:G();R(r,e)})}function bt(e){const t=G();if(R(t,e)){ue(e);return}typeof document!="undefined"&&document.addEventListener("geoleaf:map:ready",()=>{R(G(),e),ue(e)},{once:!0})}let _=null,E=null;function de(e){var t;(t=e.auth)!=null&&t.endpoint&&f._setRefreshFn(n=>s(null,null,function*(){var a;const o=f.getTokenSync(n);if(!o||!((a=e.auth)!=null&&a.endpoint))return null;const r=yield te.refresh(e.auth.endpoint,o);if(r){const i=Date.now()+r.expiresIn*1e3;return yield f.save(n,r.token,i),typeof document!="undefined"&&document.dispatchEvent(new CustomEvent("geoleaf:connector:token-refreshed",{detail:{baseUrl:n}})),r.token}return null}))}function fe(e){ae(e);let t=!0;return de(e),{getTokenSync(){if(!t)return null;if(e.getToken){const o=e.getToken();return o instanceof Promise?null:o}return f.getTokenSync(e.baseUrl)},getTokenAsync(){return s(this,null,function*(){return t?e.getToken?e.getToken():f.getTokenAsync(e.baseUrl):null})},destroy(){t=!1,f._setRefreshFn(null)}}}function vt(e){return s(this,null,function*(){var n,o;ae(e),_&&(at(),_.destroy(),ht(),_=null,E=null),E=e,(n=e.auth)!=null&&n.endpoint&&(yield f.getTokenAsync(e.baseUrl),de(e)),mt(e),globalThis.__GEOLEAF_WORKER_HEADERS_HOOK__=r=>{if(E)return gt(r,E.baseUrl)},bt(e);let t=null;if(e.getToken?t=yield e.getToken():(o=e.auth)!=null&&o.endpoint&&(t=yield f.getTokenAsync(e.baseUrl)),!t&&e.auth)if(e.auth.ui)yield M(e);else throw new v("[GeoLeaf Connector] No valid token found and auth.ui is not enabled. Configure auth.ui: true to show the login modal, or provide a valid token.");re(e),_=fe(e)})}function wt(){return s(this,null,function*(){if(!(E!=null&&E.auth))throw new v("[GeoLeaf Connector] openLoginModal() requires auth to be configured. Call GeoLeaf.Connector.configure() with auth first.");return M(E)})}function pe(){return _!==null}function yt(){return{configure:vt,openLoginModal:wt}}const kt={"connector.modal.title":"Connexion","connector.modal.close":"Fermer","connector.modal.loginLabel":"Identifiant","connector.modal.passwordLabel":"Mot de passe","connector.modal.submit":"Se connecter","connector.modal.submitting":"Connexion\u2026","connector.modal.signup":"Cr\xE9er un compte","connector.modal.forgot":"Mot de passe oubli\xE9","connector.error.emptyFields":"Veuillez remplir tous les champs.","connector.error.noEndpoint":"Configuration invalide : endpoint manquant.","connector.error.invalidCredentials":"Identifiant ou mot de passe incorrect.","connector.error.networkUnavailable":"Serveur inaccessible. V\xE9rifiez votre connexion.","connector.error.generic":"Erreur : ","connector.error.unexpected":"Une erreur inattendue est survenue."};const xt={"connector.modal.title":"Sign in","connector.modal.close":"Close","connector.modal.loginLabel":"Username","connector.modal.passwordLabel":"Password","connector.modal.submit":"Sign in","connector.modal.submitting":"Signing in\u2026","connector.modal.signup":"Create an account","connector.modal.forgot":"Forgot password","connector.error.emptyFields":"Please fill in all fields.","connector.error.noEndpoint":"Invalid configuration: missing endpoint.","connector.error.invalidCredentials":"Incorrect username or password.","connector.error.networkUnavailable":"Server unreachable. Check your connection.","connector.error.generic":"Error: ","connector.error.unexpected":"An unexpected error occurred."};const Ct={"connector.modal.title":"Iniciar sesi\xF3n","connector.modal.close":"Cerrar","connector.modal.loginLabel":"Usuario","connector.modal.passwordLabel":"Contrase\xF1a","connector.modal.submit":"Iniciar sesi\xF3n","connector.modal.submitting":"Conectando\u2026","connector.modal.signup":"Crear una cuenta","connector.modal.forgot":"Olvid\xE9 mi contrase\xF1a","connector.error.emptyFields":"Por favor, rellene todos los campos.","connector.error.noEndpoint":"Configuraci\xF3n no v\xE1lida: falta el endpoint.","connector.error.invalidCredentials":"Usuario o contrase\xF1a incorrectos.","connector.error.networkUnavailable":"Servidor inaccesible. Compruebe su conexi\xF3n.","connector.error.generic":"Error: ","connector.error.unexpected":"Se ha producido un error inesperado."};const Et={"connector.modal.title":"Entrar","connector.modal.close":"Fechar","connector.modal.loginLabel":"Nome de utilizador","connector.modal.passwordLabel":"Palavra-passe","connector.modal.submit":"Entrar","connector.modal.submitting":"A ligar\u2026","connector.modal.signup":"Criar uma conta","connector.modal.forgot":"Esqueci-me da palavra-passe","connector.error.emptyFields":"Preencha todos os campos.","connector.error.noEndpoint":"Configura\xE7\xE3o inv\xE1lida: endpoint em falta.","connector.error.invalidCredentials":"Nome de utilizador ou palavra-passe incorretos.","connector.error.networkUnavailable":"Servidor inacess\xEDvel. Verifique a sua liga\xE7\xE3o.","connector.error.generic":"Erro: ","connector.error.unexpected":"Ocorreu um erro inesperado."};const At={"connector.modal.title":"Accedi","connector.modal.close":"Chiudi","connector.modal.loginLabel":"Nome utente","connector.modal.passwordLabel":"Password","connector.modal.submit":"Accedi","connector.modal.submitting":"Connessione\u2026","connector.modal.signup":"Crea un account","connector.modal.forgot":"Password dimenticata","connector.error.emptyFields":"Compila tutti i campi.","connector.error.noEndpoint":"Configurazione non valida: endpoint mancante.","connector.error.invalidCredentials":"Nome utente o password errati.","connector.error.networkUnavailable":"Server irraggiungibile. Controlla la connessione.","connector.error.generic":"Errore: ","connector.error.unexpected":"Si \xE8 verificato un errore imprevisto."};const St={"connector.modal.title":"Anmelden","connector.modal.close":"Schlie\xDFen","connector.modal.loginLabel":"Benutzername","connector.modal.passwordLabel":"Passwort","connector.modal.submit":"Anmelden","connector.modal.submitting":"Verbinden\u2026","connector.modal.signup":"Konto erstellen","connector.modal.forgot":"Passwort vergessen","connector.error.emptyFields":"Bitte f\xFCllen Sie alle Felder aus.","connector.error.noEndpoint":"Ung\xFCltige Konfiguration: Endpunkt fehlt.","connector.error.invalidCredentials":"Benutzername oder Passwort falsch.","connector.error.networkUnavailable":"Server nicht erreichbar. Pr\xFCfen Sie Ihre Verbindung.","connector.error.generic":"Fehler: ","connector.error.unexpected":"Ein unerwarteter Fehler ist aufgetreten."};const T=globalThis;(ge=(I=(he=T.GeoLeaf)==null?void 0:he.I18n)==null?void 0:I.registerDict)==null||ge.call(I,"connector",{fr:kt,en:xt,es:Ct,pt:Et,it:At,de:St}),T.GeoLeaf&&(T.GeoLeaf.Connector=yt());let j=!1;function me(){var a,i;const t=globalThis.GeoLeaf,n=t==null?void 0:t.Config,o=(a=n==null?void 0:n.getActiveProfile)==null?void 0:a.call(n),r=(i=o==null?void 0:o.ui)!=null?i:void 0;return(r==null?void 0:r.showCredentialButton)===!0}function V(){if(!j&&!pe()&&me()){j=!0;const e={baseUrl:typeof location=="undefined"?"":location.origin,auth:{endpoint:"",credentialButton:{enabled:!0,iconVariant:"lock"}}};re(e)}}function Lt(){j=!1}typeof document!="undefined"&&(document.addEventListener("geoleaf:profile:loaded",V,{once:!0}),document.addEventListener("geoleaf:map:ready",V,{once:!0}),me()&&V()),(ve=(be=T.GeoLeaf)==null?void 0:be.plugins)!=null&&ve.register&&T.GeoLeaf.plugins.register("connector",{version:"1.2.5",requires:[],optional:["offline-ui","editor"],label:"Connector (Auth + Fetch intercept)",healthCheck:pe});export{Lt as _resetAutoBootstrapForTests,fe as createConnector};
