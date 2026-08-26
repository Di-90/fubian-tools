/**
 * 复变函数与积分变换 · 课程小工具「访问计数」服务
 * 运行在 Cloudflare Workers（免费额度足够一门课使用）。
 *
 * 端点：
 *   GET /hit?tool=T1_复平面运算器&first=1
 *        计数：该工具 PV（访问次数）+1；first=1 时 UV（访问人数）再 +1。
 *   GET /stats?key=你的口令
 *        导出：全部工具的 PV/UV 汇总为 CSV（Excel 可直接打开，含合计行）。
 *   GET /stats.json?key=你的口令
 *        导出：同样数据的 JSON。
 *
 * 需要绑定：
 *   - KV 命名空间，绑定名 = COUNTS
 *   - 环境变量 ADMIN_KEY = 一段只有你知道的导出口令
 * 具体绑定步骤见同目录《部署说明.md》。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // ───────── 计数 ─────────
    if (url.pathname === "/hit") {
      const tool = (url.searchParams.get("tool") || "unknown").slice(0, 80);
      const first = url.searchParams.get("first") === "1";

      // PV：每次打开都 +1
      const pvKey = "pv:" + tool;
      const pv = (parseInt(await env.COUNTS.get(pvKey), 10) || 0) + 1;
      await env.COUNTS.put(pvKey, String(pv));

      // UV：该浏览器首次打开本工具时 +1（由前端 localStorage 判定 first）
      let uv = parseInt(await env.COUNTS.get("uv:" + tool), 10) || 0;
      if (first) {
        uv += 1;
        await env.COUNTS.put("uv:" + tool, String(uv));
      }

      return new Response(JSON.stringify({ tool, pv, uv }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ───────── 导出（需口令）─────────
    if (url.pathname === "/stats" || url.pathname === "/stats.json") {
      if (url.searchParams.get("key") !== env.ADMIN_KEY) {
        return new Response("forbidden", { status: 403, headers: cors });
      }

      // 汇总所有 pv:/uv: 键
      const tools = {};
      let cursor;
      do {
        const list = await env.COUNTS.list({ cursor });
        for (const k of list.keys) {
          const m = /^(pv|uv):(.+)$/.exec(k.name);
          if (!m) continue;
          const t = m[2];
          tools[t] = tools[t] || { pv: 0, uv: 0 };
          tools[t][m[1]] = parseInt(await env.COUNTS.get(k.name), 10) || 0;
        }
        cursor = list.list_complete ? null : list.cursor;
      } while (cursor);

      const names = Object.keys(tools).sort();

      if (url.pathname === "/stats.json") {
        return new Response(JSON.stringify(tools, null, 2), {
          headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
        });
      }

      // CSV：加 ﻿(BOM) 让 Excel 正确识别中文
      let totalPv = 0, totalUv = 0;
      const rows = ["工具,访问次数(PV),访问人数(UV)"];
      for (const n of names) {
        rows.push(`${n},${tools[n].pv},${tools[n].uv}`);
        totalPv += tools[n].pv;
        totalUv += tools[n].uv;
      }
      rows.push(`合计,${totalPv},${totalUv}`);
      return new Response("﻿" + rows.join("\r\n"), {
        headers: {
          ...cors,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="fubian_tool_stats.csv"',
        },
      });
    }

    return new Response("fubian tool counter: ok", { headers: cors });
  },
};
