# Kimi Tianyancha MCP Bridge

将 Kimi 专业数据库（天眼查企业数据）封装为标准 MCP SSE 服务端点，部署在 Vercel Edge Runtime 上。

## 功能特性

- 🔍 **企业信息查询**：工商信息、股东信息、主要人员
- ⚖️ **司法风险查询**：失信信息、被执行人、法律诉讼
- 📚 **知识产权查询**：专利、商标、著作权
- 📊 **经营状况查询**：招投标、融资信息
- 🚀 **边缘部署**：基于 Vercel Edge Runtime，全球加速
- 💾 **短连接支持**：提供 `/poll` 端点，无需长连接

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/你的用户名/kimi-tianyancha-bridge.git
cd kimi-tianyancha-bridge
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
# 创建本地环境变量文件
echo "KIMI_API_KEY=sk-你的KimiAPIKey" > .env.local
```

### 4. 本地测试

```bash
npm run dev
# 或
vercel dev
```

访问测试：
- SSE: http://localhost:3000/sse
- Health: http://localhost:3000/health
- Poll: http://localhost:3000/poll?method=tools/list

### 5. 部署到 Vercel

```bash
# 登录 Vercel
vercel login

# 设置生产环境变量
vercel env add KIMI_API_KEY

# 部署
vercel --prod
```

## 在 Trae 中使用

部署成功后，在 Trae 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "kimi-tianyancha": {
      "url": "https://你的项目名.vercel.app/sse",
      "headers": {
        "Authorization": "Bearer sk-你的KimiAPIKey"
      }
    }
  }
}
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/sse` | GET | 建立 SSE 长连接 |
| `/messages?sessionId=xxx` | POST | 发送 MCP 消息 |
| `/health` | GET | 健康检查 |
| `/poll` | GET | 短连接轮询（Vercel 友好） |

### 短连接示例

```bash
# 获取工具列表
curl "https://你的项目名.vercel.app/poll?method=tools/list"

# 调用工具
curl "https://你的项目名.vercel.app/poll?method=tools/call&params=%7B%22name%22%3A%22tianyancha_company_search%22%2C%22arguments%22%3A%7B%22search_keyword%22%3A%22月之暗面%22%7D%7D"
```

## 注意事项

⚠️ **Vercel Edge Runtime 限制**：
- 连接是临时的，冷启动后可能丢失
- 函数最大执行时间 5 分钟
- 使用 `/poll` 端点可获得更稳定的体验

## 技术栈

- [Vercel Edge Runtime](https://vercel.com/docs/concepts/functions/edge-functions)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Kimi API](https://platform.moonshot.cn/)

## License

MIT
