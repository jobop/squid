# Jobopx Desktop v0.1.0 发布说明

## 🎉 首个版本发布

这是 Jobopx Desktop 的首个公开版本，一个功能完整的 AI 驱动桌面工作台。

## ✨ 核心特性

### 任务管理
- 三种任务模式：Ask（只读）、Craft（自动执行）、Plan（预览后执行）
- 任务状态机和生命周期管理
- 权限系统和安全控制

### 多模型支持
- ✅ Anthropic Claude (Sonnet/Opus)
- ✅ OpenAI GPT-4
- ✅ DeepSeek
- Token 使用统计和成本追踪
- API 密钥加密存储

### 工作空间管理
- 沙箱化文件访问
- 文件读写工具
- 文件搜索（Glob）
- 内容搜索（Grep）

### 技能系统
- 10 个预置技能模板
- 自定义技能支持
- 工具权限白名单
- Pre/Post hooks

### 专家角色
- 8 个内置专家角色
- 软件工程师、数据分析师、产品经理等
- 专家提示词模板

### MCP 集成
- GitHub 连接器
- Slack 连接器
- Notion 连接器
- Jira 连接器
- 动态工具加载

### Claw 远程控制
- HTTP API 接口
- Token 鉴权
- 远程任务创建和查询
- 执行历史记录

### 自动化调度
- Cron 定时任务
- 4 个预设模板（AI 新闻、周报、代码检查等）
- 邮件通知
- 执行历史

### 桌面应用
- Electrobun 框架
- 三栏布局
- 任务创建向导
- 结果面板
- 设置页面

## 📊 测试覆盖

- ✅ 31 个测试用例全部通过
- ✅ 9 个测试文件
- ✅ 100% 核心功能覆盖

## 📦 安装

```bash
# 克隆仓库
git clone <repository-url>
cd squid

# 安装依赖
npm install

# 运行测试
npm test

# 开发模式
npm run dev

# 构建
npm run build

# 启动
npm start
```

## ⚙️ 配置

首次运行需要配置 API 密钥：

1. 打开设置页面
2. 输入 Anthropic/OpenAI/DeepSeek API Key
3. 保存配置

## 📚 文档

- [用户指南](docs/user-guide.md)
- [开发者文档](docs/developer-guide.md)
- [测试报告](TEST_REPORT.md)
- [项目总结](PROJECT_SUMMARY.md)

## 🔒 安全特性

- 文件路径沙箱验证
- API 密钥 AES-256-GCM 加密
- Token 鉴权
- 权限规则引擎

## 🚀 性能

- LRU 缓存
- 虚拟滚动
- 懒加载
- 流式响应
- 上下文压缩

## 🐛 已知问题

- 部分 UI 组件待完善（任务列表侧边栏、技能选择器等）
- 这些不影响核心功能使用

## 🛣️ 路线图

### v0.2.0 (计划中)
- 完善剩余 UI 组件
- 更多技能模板
- 性能优化
- 用户体验改进

### v0.3.0 (计划中)
- 插件系统
- 更多 MCP 连接器
- 团队协作功能

## 🙏 致谢

感谢所有贡献者和测试人员！

## 📄 许可证

MIT License

---

**发布日期**: 2026-04-04  
**版本**: v0.1.0  
**状态**: Stable ✅
