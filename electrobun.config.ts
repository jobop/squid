export default {
  app: {
    name: 'squid',
    identifier: 'com.squid.desktop',
    version: '0.1.0'
  },
  scripts: {
    /** 生成 build/extension-node_modules，供 build.copy 打入 app（扩展动态 import 用） */
    preBuild: 'bun scripts/copy-extension-npm-deps.ts'
  },
  build: {
    /**
     * public：Web UI 静态资源。
     * config：含 channel-extensions.json；打包后 getSquidProjectRoot() 从 Resources/app/bun 向上可解析到 Resources/app。
     * extensions：渠道扩展源码与 manifest；不打进包则 roots 为空，飞书/微信等扩展与扩展 Web 配置页均不可用。
     * skills：内置技能 Markdown；与 ~/.squid/skills 合并扫描，同名以用户目录为准。
     * task-api-channel-errors：扩展动态 import 时需解析 `src/api/task-api-channel-errors`（无 task-api 全量依赖）。
     * extension-node_modules：preBuild 脚本从 @larksuiteoapi/node-sdk、axios 等种子 BFS 复制生产依赖，供扩展在 app 内解析。
     */
    copy: {
      public: 'public',
      config: 'config',
      extensions: 'extensions',
      skills: 'skills',
      'src/api/task-api-channel-errors.ts': 'src/api/task-api-channel-errors.ts',
      'build/extension-node_modules': 'node_modules'
    },
    bun: {
      entrypoint: './src/bun/index.ts'
    },
    // macOS：默认读取项目根目录下的 icon.iconset/（见 Electrobun Application Icons 文档）
    win: {
      icon: 'icon.iconset/icon_256x256.png'
    },
    linux: {
      icon: 'icon.iconset/icon_256x256.png'
    }
  },
  views: {
    main: {
      entrypoint: './src/browser/index.html'
    }
  },
  /** CI / 本地 stable 打包：无更新源时不生成 bsdiff 补丁 */
  release: {
    generatePatch: false
  }
};
