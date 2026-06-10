# @agenthub/android

AgentHub 原生 Android 客户端，使用 **Kotlin + Jetpack Compose（Material 3）** 构建，定位为轻量 IM 端：查看对话、发消息、围观运行、预览产物。

## 架构

单 Activity + Compose UI，状态集中在一个 `AppViewModel`；`data/` 层用 OkHttp 直连后端 REST/SSE，并刻意**镜像 `packages/shared` 的 TS 契约**（`Models.kt` 用 `@Serializable` 重声明 `AgentView` / `BlackboardArtifact` / `DeployManifest` 等）。
SSE（`ApiClient.stream`）对应服务端的 `AgentEvent` / `GroupRunEvent` 实时流，驱动 `AppViewModel` 的 turn/run 订阅。

> 默认 `DEFAULT_API_BASE_URL = "http://10.0.2.2:3000/api"` 指向模拟器宿主回环；Manifest 开启 cleartext 以允许明文连本机后端。

## 目录结构

```
apps/android/
├── build.gradle.kts                 # 根构建脚本
├── settings.gradle.kts              # 根项目 "AgentHub"，include :app + 仓库/插件管理
├── gradle.properties
├── gradle/
│   ├── libs.versions.toml           # 版本目录：AGP 9.2.1、Kotlin 2.4.0、Compose BOM 2026.05、OkHttp 等
│   └── wrapper/                      # gradle-wrapper.jar / .properties
├── gradlew / gradlew.bat
└── app/
    ├── build.gradle.kts             # app 模块：SDK 35-36、Compose/serialization 插件、依赖
    ├── proguard-rules.pro
    └── src/
        ├── main/
        │   ├── AndroidManifest.xml          # INTERNET 权限、开启 cleartext、单 MainActivity launcher
        │   ├── java/com/aichallenge/agenthub/
        │   │   ├── MainActivity.kt          # Compose 入口 Activity，把 AppViewModel 接入 AgentHubApp
        │   │   ├── ui/
        │   │   │   ├── AgentHubApp.kt        # 根 Compose UI：鉴权、会话列表/详情、底部 sheet、产物预览
        │   │   │   ├── AppViewModel.kt       # 应用状态：鉴权、加载、发消息、SSE 运行订阅
        │   │   │   └── theme/
        │   │   │       ├── Color.kt          # 品牌色常量
        │   │   │       ├── Theme.kt          # 明/暗 Material3 配色、形状、AgentHubTheme
        │   │   │       └── Type.kt           # Material3 Typography
        │   │   └── data/
        │   │       ├── Models.kt             # @Serializable DTO + DisplayMessage（镜像 shared 契约）
        │   │       ├── ApiClient.kt          # OkHttp REST + SSE 客户端，解响应信封
        │   │       ├── Repositories.kt       # 各域 API 仓库（auth/agents/chats/groups/providers）
        │   │       ├── Reducers.kt           # 纯函数：把 SSE 事件/视图归约为展示状态 + 表单校验
        │   │       └── SessionStore.kt       # DataStore 持久化会话（baseUrl/token/user）
        │   └── res/
        │       ├── values/                   # strings.xml(app_name) / colors.xml / themes.xml(Theme.AgentHub)
        │       ├── drawable/                 # ic_launcher 前景/背景矢量
        │       ├── mipmap-*/                 # 各密度 launcher 图标
        │       └── xml/                      # backup_rules / data_extraction_rules
        ├── test/java/com/aichallenge/agenthub/
        │   ├── ReducersTest.kt               # reducers/校验单测（会话排序、运行归约、表单）
        │   └── ExampleUnitTest.kt            # 脚手架默认单测
        └── androidTest/java/com/aichallenge/agenthub/
            └── ExampleInstrumentedTest.kt    # 脚手架默认 instrumented 测试
```

## 常用命令

```bash
cd apps/android
./gradlew assembleDebug      # 构建 debug APK
./gradlew test               # 单元测试（含 ReducersTest）
./gradlew installDebug       # 安装到已连接设备/模拟器
```

> 该模块未纳入 pnpm workspace 脚本，独立用 Gradle 构建。
