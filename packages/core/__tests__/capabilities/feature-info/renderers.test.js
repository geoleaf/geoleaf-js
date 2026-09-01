import { describe, it, expect, afterEach } from "vitest";
import {
    renderText,
    renderBadge,
    renderLink,
    renderList,
    renderTable,
    renderTags,
    renderRating,
    renderReviews,
} from "../../../src/capabilities/feature-info/render/fields.js";
import { renderImage, renderGallery } from "../../../src/capabilities/feature-info/render/media.js";
import {
    LightboxManager,
    attachGalleryEvents,
    attachSingleAccordionBehavior,
} from "../../../src/capabilities/feature-info/render/lightbox.js";
import {
    el,
    escapeHtml,
    safeUrl,
    i18n,
    svgUseIcon,
    resolveTitleIcon,
} from "../../../src/capabilities/feature-info/render/dom.js";
import { buildSidePanelBody } from "../../../src/capabilities/feature-info/render/sidepanel-content.js";
import {
    buildPopupContent,
    buildTooltipText,
} from "../../../src/capabilities/feature-info/render/popup-content.js";
import {
    buildNormalizedModel,
    resolvePath,
} from "../../../src/capabilities/feature-info/resolve.js";
const F = (o) => o;
afterEach(() => {
    document.querySelectorAll(".gl-poi-lightbox-global").forEach((n) => n.remove());
    delete globalThis.GeoLeaf;
});
describe("dom helpers", () => {
    it("el() sets tag, class and attributes", () => {
        const node = el("a", "cls", { href: "#", "data-x": "1" });
        expect(node.tagName).toBe("A");
        expect(node.className).toBe("cls");
        expect(node.getAttribute("href")).toBe("#");
        expect(node.getAttribute("data-x")).toBe("1");
    });
    it("escapeHtml() escapes via the local fallback", () => {
        expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
    });
    it("escapeHtml() delegates to the GeoLeaf.Security seam", () => {
        globalThis.GeoLeaf = {
            Security: { escapeHtml: () => "H" },
        };
        expect(escapeHtml("x")).toBe("H");
    });
    it("safeUrl() accepts http(s) and rejects other schemes / non-strings", () => {
        expect(safeUrl("https://ok.com")).toBe("https://ok.com");
        expect(safeUrl("javascript:alert(1)")).toBeNull();
        expect(safeUrl(42)).toBeNull();
        expect(safeUrl("")).toBeNull();
    });
    it("safeUrl() honours the security seam (throw \u2192 null, return \u2192 value)", () => {
        globalThis.GeoLeaf = {
            Security: {
                validateUrl: (u) => {
                    if (u.includes("bad")) throw new Error("unsafe");
                    return u + "!";
                },
            },
        };
        expect(safeUrl("https://good.com")).toBe("https://good.com!");
        expect(safeUrl("https://bad.com")).toBeNull();
    });
    it("i18n() uses the seam when present, else the fallback", () => {
        expect(i18n("k", "fb")).toBe("fb");
        globalThis.GeoLeaf = {
            I18n: { t: (_k, fb) => "T:" + fb },
        };
        expect(i18n("k", "fb")).toBe("T:fb");
    });
});
describe("resolve", () => {
    it("resolves properties.* / attributes.* / bare / miss", () => {
        const m = buildNormalizedModel({ Name: "N", attributes: { photo: "p" } });
        expect(resolvePath(m, "properties.Name")).toBe("N");
        expect(resolvePath(m, "attributes.photo")).toBe("p");
        expect(resolvePath(m, "Name")).toBe("N");
        expect(resolvePath(m, "missing")).toBeUndefined();
        expect(resolvePath(m, "")).toBeUndefined();
    });
    it("parses a JSON-string attributes bag", () => {
        const m = buildNormalizedModel({ attributes: '{"k":"v"}' });
        expect(resolvePath(m, "attributes.k")).toBe("v");
    });
    it("falls back to the flat bag for a properties.* path", () => {
        const m = buildNormalizedModel({ Name: "flat" });
        expect(resolvePath(m, "properties.Name")).toBe("flat");
    });
});
describe("field renderers", () => {
    it("renderText: title / normal / multiline / empty", () => {
        const title = renderText(F({ field: "n", style: "title" }), "T");
        expect(title?.querySelector(".gl-poi-sidepanel__title-text")?.textContent).toBe("T");
        expect(renderText(F({ field: "n" }), "hi")?.className).toBe("gl-poi-sidepanel__desc");
        const ml = renderText(F({ field: "n", variant: "multiline" }), "hi");
        expect(ml.style.whiteSpace).toBe("pre-wrap");
        expect(renderText(F({ field: "n" }), "")).toBeNull();
    });
    it("renderBadge", () => {
        expect(
            renderBadge(F({ field: "c" }), "Cat")?.querySelector(".gl-poi-badge")?.textContent
        ).toBe("Cat");
        expect(renderBadge(F({ field: "c" }), "")).toBeNull();
    });
    it("renderLink validates the URL at the sink", () => {
        const ok = renderLink(F({ field: "s", label: "Go" }), "https://ok.com");
        expect(ok?.querySelector("a.gl-poi-website-link")?.getAttribute("href")).toBe(
            "https://ok.com"
        );
        expect(renderLink(F({ field: "s" }), "javascript:x")).toBeNull();
        expect(renderLink(F({ field: "s" }), "")).toBeNull();
    });
    it("renderList: array and price object", () => {
        const ul = renderList(F({ field: "t", variant: "square" }), ["a", "b"]);
        expect(ul?.querySelectorAll("ul.gl-poi-list-unordered li").length).toBe(2);
        const price = renderList(F({ field: "p" }), { from: 10, to: 20, currency: "EUR" });
        expect(price?.textContent).toContain("From 10 to 20 EUR");
        expect(renderList(F({ field: "t" }), "")).toBeNull();
    });
    it("renderTable renders header + rows and splits 2-column strings", () => {
        const t = renderTable(
            F({
                field: "r",
                columns: [
                    { key: "jour", label: "Jour" },
                    { key: "h", label: "Heure" },
                ],
            }),
            ["Lun : 9h", "Mar : 10h"]
        );
        expect(t?.querySelectorAll("thead th").length).toBe(2);
        expect(t?.querySelectorAll("tbody tr").length).toBe(2);
        expect(t?.querySelector("tbody td")?.textContent).toBe("Lun");
        expect(renderTable(F({ field: "r" }), "nope")).toBeNull();
    });
    it("renderTags normalizes arrays, delimited and JSON strings", () => {
        expect(
            renderTags(F({ field: "t" }), ["x", "y"])?.querySelectorAll(".gl-poi-tag").length
        ).toBe(2);
        expect(
            renderTags(F({ field: "t" }), "a, b; c")?.querySelectorAll(".gl-poi-tag").length
        ).toBe(3);
        // ⚠️ This assertion called `normalizeTagsInput` DIRECTLY. The symbol
        // is un-exported: its only production caller is `renderTags`, in the
        // same file. The guarantee is kept, it simply goes through the public
        // path — a JSON string does yield two tags.
        expect(
            renderTags(F({ field: "t" }), '["j","k"]')?.querySelectorAll(".gl-poi-tag").length
        ).toBe(2);
        expect(renderTags(F({ field: "t" }), 42)).toBeNull();
    });
    it("renderRating draws five stars and the value", () => {
        const r = renderRating(F({ field: "n", label: "Note" }), 4);
        expect(r?.querySelectorAll(".gl-rating__star").length).toBe(5);
        expect(r?.querySelectorAll(".gl-rating__star--filled").length).toBe(4);
        expect(r?.querySelector(".gl-rating__value")?.textContent).toBe("4.0/5");
        expect(renderRating(F({ field: "n" }), "nope")).toBeNull();
    });
    it("renderReviews caps and renders entries", () => {
        const rv = renderReviews(F({ field: "r", maxCount: 1 }), [
            { authorName: "A", rating: 5, verified: true, comment: "Bien", createdAt: "2026" },
            { authorName: "B", rating: 3 },
        ]);
        expect(rv?.querySelectorAll(".gl-poi-review").length).toBe(1);
        expect(rv?.textContent).toContain("A");
        expect(rv?.textContent).toContain("Bien");
        expect(renderReviews(F({ field: "r" }), "nope")).toBeNull();
    });
});
describe("media renderers", () => {
    it("renderImage: hero vs normal vs unsafe", () => {
        expect(
            renderImage(F({ field: "p", variant: "hero" }), "https://e.com/a.jpg")?.className
        ).toContain("gl-poi-sidepanel__photo--hero");
        expect(renderImage(F({ field: "p" }), "https://e.com/a.jpg")?.className).toBe(
            "gl-poi-sidepanel__photo"
        );
        expect(renderImage(F({ field: "p" }), "javascript:x")).toBeNull();
        expect(renderImage(F({ field: "p" }), "")).toBeNull();
    });
    it("renderGallery: main only vs main + thumbnails, thumbnail swaps main", () => {
        expect(
            renderGallery(F({ field: "g" }), ["https://e.com/1.jpg"])?.querySelector(
                ".gl-poi-gallery__thumbnails"
            )
        ).toBeNull();
        const g = renderGallery(F({ field: "g" }), ["https://e.com/1.jpg", "https://e.com/2.jpg"]);
        const thumbs = g.querySelectorAll(".gl-poi-gallery__thumb");
        expect(thumbs.length).toBe(2);
        thumbs[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(thumbs[1].classList.contains("active")).toBe(true);
        expect(renderGallery(F({ field: "g" }), [])).toBeNull();
    });
});
describe("LightboxManager", () => {
    it("opens a single image without navigation", () => {
        const lb = new LightboxManager();
        lb.open("https://e.com/1.jpg");
        expect(lb.isOpen()).toBe(true);
        expect(document.querySelector(".gl-poi-lightbox__next")).toBeNull();
        lb.close();
        expect(lb.isOpen()).toBe(false);
    });
    // A lightbox can hold links — a photo credit, a source URL. The trap's
    // selector must see them, or Tab walks straight out of a dialog the user
    // cannot see past, which is exactly what a focus trap exists to prevent.
    it("traps Tab on a link, not just on buttons", () => {
        const lb = new LightboxManager();
        lb.open("https://e.com/1.jpg");
        const box = document.querySelector(".gl-poi-lightbox-global");
        const closeBtn = box.querySelector(".gl-poi-lightbox__close");

        const credit = document.createElement("a");
        credit.href = "https://e.com/credit";
        box.appendChild(credit);

        credit.focus();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));

        // The link is the last focusable, so Tab must cycle back to the first.
        expect(document.activeElement).toBe(closeBtn);
        lb.close();
    });

    it("navigates a multi-image gallery with arrows + counter", () => {
        const lb = new LightboxManager();
        lb.open("https://e.com/1.jpg", [
            "https://e.com/1.jpg",
            "https://e.com/2.jpg",
            "https://e.com/3.jpg",
        ]);
        const img = document.querySelector(".gl-poi-lightbox__image");
        expect(document.querySelector(".gl-poi-lightbox__counter")?.textContent).toBe("1 / 3");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(img.src).toContain("2.jpg");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
        expect(img.src).toContain("1.jpg");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(lb.isOpen()).toBe(false);
    });
});
describe("buildSidePanelBody — horaires de forme inattendue (B.32)", () => {
    it("ne lève pas quand hours[jour] est une chaîne au lieu d'un tableau", () => {
        // `renderHoursTable` did `const slots = hours[day] ?? []` then
        // `slots.filter(...)`. A non-empty STRING does have `.length`, and
        // `slots[0]?.closed` is `undefined` — so we fall into the `else`
        // branch and `.filter is not a function`. The exception climbs to
        // `buildSidePanelBody`: the side panel does not open. The only
        // existing hours test uses only the perfect shape.
        const fields = [F({ field: "hr", type: "hours" })];
        expect(() =>
            buildSidePanelBody(fields, { hr: { mon: "9h-18h" } }, { layerId: "l1" })
        ).not.toThrow();
    });

    it("ne lève pas quand hours[jour] est un objet ou un nombre", () => {
        const fields = [F({ field: "hr", type: "hours" })];
        expect(() =>
            buildSidePanelBody(fields, { hr: { tue: { open: "9" }, wed: 42 } }, { layerId: "l1" })
        ).not.toThrow();
    });

    it("rend toujours correctement la forme canonique", () => {
        // Non-regression guard: the fix must not swallow valid data.
        const fields = [F({ field: "hr", type: "hours" })];
        const body = buildSidePanelBody(
            fields,
            { hr: { mon: [{ open: "9", close: "18", closed: false }] } },
            { layerId: "l1" }
        );
        expect(body.querySelector("table.gl-poi-hours")).not.toBeNull();
        expect(body.textContent).toContain("9");
        expect(body.textContent).toContain("18");
    });
});
describe("attachGalleryEvents — données distantes hostiles (B.32)", () => {
    it("ne lève pas quand une vignette n'a pas d'<img> (URL refusée par safeUrl)", () => {
        // `media.ts` DELIBERATELY produces an <img>-less thumbnail
        // when `safeUrl` refuses the URL: "an unsafe URL yields an empty
        // (non-interactive) thumbnail rather than an unsafe img.src sink".
        // `attachGalleryEvents` yet did `thumb.querySelector("img").src`
        // unguarded — two deliberate intentions contradicting each other. A
        // remote gallery with ONE refused URL raised a TypeError INSIDE
        // `buildSidePanelBody`, and the side panel did not open at all.
        const g = renderGallery(F({ field: "g" }), [
            "https://e.com/1.jpg",
            "javascript:alert(1)", // refusée → vignette sans <img>
            "https://e.com/3.jpg",
        ]);
        const wrap = el("div");
        wrap.appendChild(g);
        expect(wrap.querySelectorAll(".gl-poi-gallery__thumb").length).toBe(3);
        expect(wrap.querySelectorAll(".gl-poi-gallery__thumb img").length).toBe(2);
        expect(() => attachGalleryEvents(wrap, new LightboxManager())).not.toThrow();
    });

    it("un clic sur une vignette vide ne lève pas et ne change pas l'image principale", () => {
        const g = renderGallery(F({ field: "g" }), ["https://e.com/1.jpg", "javascript:alert(1)"]);
        const wrap = el("div");
        wrap.appendChild(g);
        attachGalleryEvents(wrap, new LightboxManager());
        const main = g.querySelector(".gl-poi-gallery__main img");
        const before = main.src;
        const empty = wrap.querySelector('.gl-poi-gallery__thumb[data-index="1"]');
        expect(() => empty.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();
        expect(main.src).toBe(before);
    });
});
describe("attachGalleryEvents", () => {
    it("opens the lightbox on main-image click and syncs thumbnails on nav", () => {
        const g = renderGallery(F({ field: "g" }), ["https://e.com/1.jpg", "https://e.com/2.jpg"]);
        const wrap = el("div");
        wrap.appendChild(g);
        const lb = new LightboxManager();
        attachGalleryEvents(wrap, lb);
        g.querySelector(".gl-poi-gallery__main img").dispatchEvent(
            new MouseEvent("click", { bubbles: true })
        );
        expect(lb.isOpen()).toBe(true);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
        expect(
            wrap
                .querySelector('.gl-poi-gallery__thumb[data-index="1"]')
                ?.classList.contains("active")
        ).toBe(true);
        lb.close();
    });
    it("swaps the main image when a thumbnail is clicked", () => {
        const g = renderGallery(F({ field: "g" }), ["https://e.com/1.jpg", "https://e.com/2.jpg"]);
        const wrap = el("div");
        wrap.appendChild(g);
        attachGalleryEvents(wrap, new LightboxManager());
        const main = g.querySelector(".gl-poi-gallery__main img");
        const thumb1 = wrap.querySelector('.gl-poi-gallery__thumb[data-index="1"]');
        thumb1.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(main.src).toContain("2.jpg");
        expect(thumb1.classList.contains("active")).toBe(true);
    });
    it("is a no-op when the panel has no gallery", () => {
        expect(() => attachGalleryEvents(el("div"), new LightboxManager())).not.toThrow();
        expect(() => attachGalleryEvents(null, new LightboxManager())).not.toThrow();
    });
});
describe("attachSingleAccordionBehavior", () => {
    it("collapses sibling accordions when one is opened", () => {
        const box = el("div");
        const a = document.createElement("details");
        a.className = "gl-accordion";
        a.open = true;
        const b = document.createElement("details");
        b.className = "gl-accordion";
        b.open = true;
        box.append(a, b);
        attachSingleAccordionBehavior(box);
        a.dispatchEvent(new Event("toggle"));
        expect(b.open).toBe(false);
    });
    it("is a no-op when there are no accordions", () => {
        expect(() => attachSingleAccordionBehavior(el("div"))).not.toThrow();
    });
});
describe("content builders", () => {
    it("buildSidePanelBody dispatches every field type", () => {
        const fields = [
            F({ field: "title", type: "text", style: "title" }),
            F({ field: "desc", type: "longtext" }),
            F({ field: "num", type: "number" }),
            F({ field: "met", type: "metric", prefix: "~", suffix: " m" }),
            F({ field: "pr", type: "price" }),
            F({ field: "co", type: "coordinates" }),
            F({ field: "img", type: "image" }),
            F({ field: "gal", type: "gallery" }),
            F({ field: "bad", type: "badge" }),
            F({ field: "lnk", type: "link" }),
            F({ field: "lst", type: "list" }),
            F({ field: "tbl", type: "table", columns: [{ key: "a", label: "A" }] }),
            F({ field: "tg", type: "tags" }),
            F({ field: "rt", type: "rating" }),
            F({ field: "rv", type: "reviews" }),
            F({ field: "hr", type: "hours" }),
            F({ field: "rad", type: "radio" }),
            F({ field: "drp", type: "dropdown" }),
            F({ field: "phn", type: "phone" }),
            F({ field: "chk", type: "checkbox" }),
            F({ field: "mystery", type: "mystery" }),
        ];
        const props = {
            title: "T",
            desc: "D",
            num: 3,
            met: 5,
            pr: { amount: 10, currency: "EUR" },
            co: { lat: 1.5, lng: 2.5 },
            img: "https://e.com/a.jpg",
            gal: ["https://e.com/1.jpg", "https://e.com/2.jpg"],
            bad: "B",
            lnk: "https://e.com",
            lst: ["x", "y"],
            tbl: [{ a: "1" }],
            tg: ["t1", "t2"],
            rt: 4,
            rv: [{ authorName: "A", rating: 5 }],
            hr: { mon: [{ open: "9", close: "18", closed: false }] },
            rad: "r",
            drp: "d",
            phn: "0102",
            chk: true,
            mystery: "?",
        };
        const bodyEl = buildSidePanelBody(fields, props, { layerId: "l1" });
        expect(bodyEl.className).toBe("gl-poi-sidepanel__body");
        expect(bodyEl.querySelector(".gl-poi-sidepanel__title")).not.toBeNull();
        expect(bodyEl.querySelector("table.gl-poi-hours")).not.toBeNull();
    });
    it("buildTooltipText joins values, skips image/action, escapes", () => {
        const text = buildTooltipText(
            [
                F({ field: "name" }),
                F({ field: "cat", type: "badge" }),
                F({ field: "photo", type: "image" }),
                F({ field: "cta", type: "action" }),
            ],
            { name: "<b>Lac</b>", cat: "Parc", photo: "https://e.com/a.jpg", cta: "x" }
        );
        expect(text).toBe("&lt;b&gt;Lac&lt;/b&gt; | Parc");
    });
});

describe("category title icon (taxonomy render → feature-info)", () => {
    // Stubs the `GeoLeaf.Taxonomy` seam consumed by resolveTitleIcon.
    function stubTaxonomy({ icon = null } = {}) {
        let ensured = 0;
        globalThis.GeoLeaf = {
            Taxonomy: {
                resolveTitleIcon: () => icon,
                ensureSprite: () => {
                    ensured++;
                },
            },
        };
        return () => ensured;
    }

    it("svgUseIcon builds a CSP-safe <svg><use> via createElementNS (no innerHTML)", () => {
        const svg = svgUseIcon("ref-poi-cat-museum");
        expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(svg.getAttribute("class")).toBe("gl-fi-cat-icon");
        expect(svg.getAttribute("aria-hidden")).toBe("true");
        const use = svg.querySelector("use");
        expect(use.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(use.getAttribute("href")).toBe("#ref-poi-cat-museum");
        // The <use> is a real namespaced Element node (built via createElementNS),
        // not injected as text/markup — the sole child of the <svg>.
        expect(use.nodeType).toBe(1);
        expect(svg.childNodes.length).toBe(1);
    });

    it("resolveTitleIcon returns the seam's symbolId and ensures the sprite", () => {
        const getEnsured = stubTaxonomy({ icon: "ref-poi-cat-museum" });
        expect(resolveTitleIcon("pois", { categoryId: "museum" }, "popup")).toBe(
            "ref-poi-cat-museum"
        );
        expect(getEnsured()).toBe(1);
    });

    it("resolveTitleIcon returns null when the seam resolves no icon", () => {
        stubTaxonomy({ icon: null });
        expect(resolveTitleIcon("pois", { categoryId: "museum" }, "popup")).toBeNull();
    });

    it("resolveTitleIcon returns null when no Taxonomy seam is mounted", () => {
        expect(resolveTitleIcon("pois", { categoryId: "museum" }, "popup")).toBeNull();
    });

    it("renderText prefixes the glyph BEFORE the title text when an icon is given", () => {
        const h2 = renderText(F({ style: "title" }), "Puerto Valle", "ref-poi-cat-museum");
        expect(h2.tagName.toLowerCase()).toBe("h2");
        expect(h2.querySelector("use").getAttribute("href")).toBe("#ref-poi-cat-museum");
        expect(h2.querySelector(".gl-poi-sidepanel__title-text").textContent).toBe("Puerto Valle");
    });

    it("renderText title stays byte-identical (no glyph) without an icon", () => {
        const h2 = renderText(F({ style: "title" }), "Puerto Valle");
        expect(h2.querySelector("svg")).toBeNull();
        expect(h2.querySelector(".gl-poi-sidepanel__title-text").textContent).toBe("Puerto Valle");
    });

    it("buildPopupContent prefixes the title glyph via the seam", () => {
        stubTaxonomy({ icon: "ref-poi-cat-museum" });
        const node = buildPopupContent(
            [F({ type: "text", field: "properties.name", variant: "title" })],
            { name: "Puerto Valle", categoryId: "museum" },
            { layerId: "pois" },
            { hasSidepanel: false }
        );
        const title = node.querySelector(".gl-poi-popup__title");
        expect(title.querySelector("use").getAttribute("href")).toBe("#ref-poi-cat-museum");
        expect(title.textContent).toContain("Puerto Valle");
    });

    it("buildPopupContent title stays byte-identical when no seam is mounted", () => {
        const node = buildPopupContent(
            [F({ type: "text", field: "properties.name", variant: "title" })],
            { name: "Puerto Valle", categoryId: "museum" },
            { layerId: "pois" },
            { hasSidepanel: false }
        );
        const title = node.querySelector(".gl-poi-popup__title");
        expect(title.querySelector("svg")).toBeNull();
        expect(title.textContent).toBe("Puerto Valle");
    });

    it("buildSidePanelBody prefixes the title glyph via the seam", () => {
        stubTaxonomy({ icon: "ref-poi-cat-museum" });
        const body = buildSidePanelBody(
            [F({ type: "text", field: "properties.name", style: "title" })],
            { name: "Puerto Valle", categoryId: "museum" },
            { layerId: "pois" }
        );
        const title = body.querySelector(".gl-poi-sidepanel__title");
        expect(title.querySelector("use").getAttribute("href")).toBe("#ref-poi-cat-museum");
        expect(title.querySelector(".gl-poi-sidepanel__title-text").textContent).toBe(
            "Puerto Valle"
        );
    });

    it("buildSidePanelBody title stays byte-identical when no seam is mounted", () => {
        const body = buildSidePanelBody(
            [F({ type: "text", field: "properties.name", style: "title" })],
            { name: "Puerto Valle", categoryId: "museum" },
            { layerId: "pois" }
        );
        const title = body.querySelector(".gl-poi-sidepanel__title");
        expect(title.querySelector("svg")).toBeNull();
        expect(title.querySelector(".gl-poi-sidepanel__title-text").textContent).toBe(
            "Puerto Valle"
        );
    });
});

// A title can be written two ways in the RENDER model — `variant: "title"` or
// `style: "title"` — and nothing kept an author from using either on any
// surface. The popup honoured both; the panel honoured only `style`, which
// silently degraded a title written as `variant`: no longer treated as a
// required field (hence vanished when empty) and rendered without its
// taxonomy glyph.
//
// ⚠️ The original comment attributed this freedom to
// `detail-blocks.schema.json`, "which keeps both as free strings". That
// schema was an ORPHAN no `$ref` pointed at — it guarded nothing at all, and
// it is deleted. The freedom came from the internal render model, whose
// `variant` and `style` are `string`s. The DECLARATION now has one spelling,
// `display.presentation.emphasis`, constrained to three values — but the
// render model keeps both, so these tests still guard something.
describe("title predicate — `variant` and `style` are equivalent on both surfaces", () => {
    function stubTaxonomy({ icon = null } = {}) {
        globalThis.GeoLeaf = {
            Taxonomy: { resolveTitleIcon: () => icon, ensureSprite: () => {} },
        };
    }

    it("sidepanel keeps a `variant` title when its value is empty (required field)", () => {
        const body = buildSidePanelBody(
            [F({ type: "text", field: "properties.name", variant: "title" })],
            { name: "", categoryId: "museum" },
            { layerId: "pois" }
        );
        expect(body.querySelector(".gl-poi-sidepanel__title")).not.toBeNull();
    });

    it("sidepanel prefixes the taxonomy glyph on a `variant` title", () => {
        stubTaxonomy({ icon: "ref-poi-cat-museum" });
        const body = buildSidePanelBody(
            [F({ type: "text", field: "properties.name", variant: "title" })],
            { name: "Puerto Valle", categoryId: "museum" },
            { layerId: "pois" }
        );
        const title = body.querySelector(".gl-poi-sidepanel__title");
        expect(title.querySelector("use").getAttribute("href")).toBe("#ref-poi-cat-museum");
    });

    // Mirrors of the two above, already green — they prove the fix is additive
    // rather than a swap of one spelling for the other.
    it("sidepanel still keeps a `style` title when its value is empty", () => {
        const body = buildSidePanelBody(
            [F({ type: "text", field: "properties.name", style: "title" })],
            { name: "", categoryId: "museum" },
            { layerId: "pois" }
        );
        expect(body.querySelector(".gl-poi-sidepanel__title")).not.toBeNull();
    });

    it("popup honours both spellings, unchanged", () => {
        for (const spelling of [{ variant: "title" }, { style: "title" }]) {
            const node = buildPopupContent(
                [F({ type: "text", field: "properties.name", ...spelling })],
                { name: "Puerto Valle" },
                { layerId: "pois" },
                { hasSidepanel: false }
            );
            expect(node.querySelector(".gl-poi-popup__title").textContent).toBe("Puerto Valle");
        }
    });
});
