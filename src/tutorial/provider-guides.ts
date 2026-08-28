export interface ProviderGuide {
  id: string;
  name: string;
  shortName: string;
  description: string;
  markdown: string;
}

const DEEPSEEK_GUIDE = String.raw`
# DeepSeek API Key 申请

两分钟就能搞定。准备好账号，我们出发 🚀

[打开 DeepSeek API Keys 页面 →](https://platform.deepseek.com/api_keys)

---

## 1. 来到 API Keys 页面

登录 DeepSeek 开放平台后，打开 **API keys** 页面。看到右上角的 **创建 API key** 了吗？对，就是它。

![DeepSeek API Keys 页面，右上角提供创建 API key 按钮](/resources/tutorial/deepseek/api-keys-page.png)

*先点右上角的「创建 API key」。点击图片可以放大查看。*

## 2. 给它起个好认的名字

名称写 **PDFPal** 就很清楚，当然，叫“小钥匙一号”也不是不行。确认创建后，平台会生成一串以 **sk-** 开头的 Key。

## 3. 复制，然后收好

![DeepSeek API Key 创建成功并出现在列表中](/resources/tutorial/deepseek/api-key-created.png)

*看到“API key 已创建”，这一步就完成啦。点击图片可以放大查看。*

> **重要：** Key 和密码一样重要。创建后马上复制，只放进 PDFPal 的供应商设置，不要发到聊天、截图或公开仓库里。

如果不小心弄丢了，也别慌：删除旧 Key，再创建一个新的就好。

## 4. PDFPal 的 API 地址填什么？

在 PDFPal 添加 DeepSeek 供应商时，API 地址直接填写：

~~~text
https://api.deepseek.com
~~~

就填到这里，不用再加 **/chat/completions**。剩下的交给 PDFPal 👌
`;

const BAILIAN_GUIDE = String.raw`
# 阿里云百炼 API Key 申请

模型很多，入口也多一点，但别担心——我们只走最短路线 🧭

[打开百炼 API Key 管理页 →](https://bailian.console.aliyun.com/?tab=model#/api-key)

---

## 1. 创建一把新的 API Key

进入百炼控制台后，点击左下角的 **API Key**，再点右上角的 **创建 API Key**。描述写 **PDFPal**，以后回来一眼就能认出来。

![阿里云百炼 API Key 管理页面和创建 API Key 按钮](/resources/tutorial/bailian/api-key-page.png)

*左下角进门，右上角拿钥匙。点击图片可以放大查看。*

创建时选择你要使用的业务空间；第一次使用，选择 **默认业务空间** 通常就够了。完整 Key 只在创建后展示一次，记得马上复制并收好。

> **安全提醒：** API Key 就是密码。只放进 PDFPal，不要把完整内容留在截图、聊天或公开仓库里。

## 2. 复制自己的请求地址

百炼很贴心：API Key 页面上方已经放好了 **OpenAI compatible** 请求地址。点击右侧复制按钮，把它填进 PDFPal 的“API 地址”。

![阿里云百炼 API Key 页面顶部的 OpenAI compatible 请求地址](/resources/tutorial/bailian/openai-base-url.png)

*复制你自己页面上显示的地址，不要照抄截图里的地址。点击图片可以放大查看。*

不同业务空间的专属地址可能不同，通常长这样：

~~~text
https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
~~~

复制到 **/compatible-mode/v1** 就停，不用再加 **/chat/completions**。

## 3. 别忘了看看免费额度

百炼一个很香的地方是：**不少文本、视觉、全模态、语音和向量模型都会赠送免费 Token 额度**。刚开始体验 PDFPal 时，可以先用这些额度慢慢挑模型。

![阿里云百炼用量与费用页面中各模型的免费额度](/resources/tutorial/bailian/free-quota.png)

*进入“用量与费用 → 免费额度”，每个模型还剩多少、什么时候到期，都写得明明白白。点击图片可以放大查看。*

如果你只想先免费体验，可以为需要的模型开启 **免费额度用完即停**。额度用完后会停止调用，不会悄悄进入付费模式，这个开关很适合刚上手时使用。

> 免费额度的模型范围、数量和有效期可能随账号、地域及活动变化，请以你自己的百炼控制台为准。
`;

const SILICONFLOW_GUIDE = String.raw`
# 硅基流动 API Key 申请

第三家就简单一点：前面的套路已经会了，这次一分钟收工 ⚡

[打开硅基流动 API 密钥页面 →](https://cloud.siliconflow.cn/account/ak)

---

## 1. 新建一把 API Key

登录后进入 **API 密钥**，点击 **新建 API 密钥**。名称写 **PDFPal**，创建后复制并妥善保存。

> Key 和密码一样，只放进 PDFPal，不要发到聊天、截图或公开仓库里。

## 2. API 地址填这个

在 PDFPal 添加供应商时选择 **OpenAI 兼容接口**，API 地址填写：

~~~text
https://api.siliconflow.cn/v1
~~~

末尾的 **/v1** 要保留，不用再加 **/chat/completions**。

## 3. 测试，然后选模型

粘贴 API Key 后，点击 **测试并获取模型**。连接成功后，从返回的列表里选择聊天、翻译或视觉模型，最后保存配置。

硅基流动一把 Key 可以调用平台上的多种模型。以后想换模型，回来重新选择就好，不用再申请一把新 Key。
`;

export const PROVIDER_GUIDES: readonly ProviderGuide[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    shortName: "DS",
    description: "申请与创建 API Key",
    markdown: DEEPSEEK_GUIDE,
  },
  {
    id: "bailian",
    name: "阿里云百炼",
    shortName: "BL",
    description: "密钥、请求地址与免费额度",
    markdown: BAILIAN_GUIDE,
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    shortName: "SF",
    description: "一把 Key 连接多种模型",
    markdown: SILICONFLOW_GUIDE,
  },
];
