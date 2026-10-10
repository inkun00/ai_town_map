import {describe,expect,it} from "vitest";
import {pinSvg,selectionPinSvg} from "../src/domain/point-presentation";

describe("merge selection pin meaning",()=>{
  it("uses a solid blue body and a drawn check for selected points",()=>{
    const svg=selectionPinSvg("🌳","selected");
    expect(svg).toContain('data-selection-state="selected"');
    expect(svg).toContain('fill="#1d4ed8"');
    expect(svg).toContain('d="m40 47 4 4 8-9"');
    expect(svg).not.toContain("stroke-dasharray");
  });

  it("uses a pale dashed body and hollow circle for unselected points",()=>{
    const svg=selectionPinSvg("🌳","unselected");
    expect(svg).toContain('fill="#f1f5f9"');
    expect(svg).toContain('stroke-dasharray="5 3"');
    expect(svg).toContain('cx="46" cy="46" r="6" fill="none"');
    expect(svg).not.toContain('d="m40 47 4 4 8-9"');
  });

  it("shows exact selected counts and distinguishes all, none and mixed groups",()=>{
    const all=selectionPinSvg("🚸","selected",false,4,4);
    const none=selectionPinSvg("🚸","unselected",false,0,4);
    const mixed=selectionPinSvg("🚸","mixed",false,2,4);
    expect(all).toContain('>4/4</text>');expect(none).toContain('>0/4</text>');expect(mixed).toContain('>2/4</text>');
    expect(all).toContain('rx="7" fill="#1d4ed8" stroke="#1d4ed8"');expect(all).toContain('fill="white">4/4</text>');
    expect(none).toContain('rx="7" fill="white" stroke="#64748b"');expect(none).toContain('fill="#64748b">0/4</text>');
    expect(mixed).toContain('rx="7" fill="white" stroke="#1d4ed8"');expect(mixed).toContain('fill="#1d4ed8">2/4</text>');
    expect(mixed).toContain('clip-path="url(#pin-body)"');
    expect(mixed).toContain('data-selection-state="mixed"');
    expect(selectionPinSvg("🌳","selected",false,1000,1000)).toContain('font-size="10"');
  });

  it("keeps keyboard focus independent of selection and safely escapes custom glyphs",()=>{
    const svg=selectionPinSvg('<script>&"',"unselected",true);
    expect(svg).toContain('stroke="#0f172a" stroke-width="4"');
    expect(svg).toContain('stroke-dasharray="5 3"');
    expect(svg).toContain('&lt;script&gt;&amp;&quot;');expect(svg).not.toContain("<script>");
    expect(selectionPinSvg("🌳","mixed",false,Number.NaN,Number.POSITIVE_INFINITY)).not.toContain("NaN");
  });

  it("leaves ordinary map evaluation badges unchanged",()=>{
    const svg=pinSvg("🌳","#C62828",true,"×");
    expect(svg).toContain('fill="#C62828"');expect(svg).toContain('>×</text>');
    expect(svg).not.toContain("data-selection-state");
  });
});
