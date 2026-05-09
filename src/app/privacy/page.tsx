export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50 p-8">
      <div className="max-w-2xl mx-auto glass-card rounded-3xl p-8">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">隐私政策</h1>
        <div className="text-sm text-gray-600 space-y-4 leading-relaxed">
          <p><strong>更新日期：</strong>2026 年 1 月 1 日</p>

          <h3 className="font-bold text-gray-800 mt-4">一、我们收集的信息</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>基本信息：</strong>昵称、邮箱、性别偏好（注册时填写）</li>
            <li><strong>位置信息：</strong>GPS 坐标（仅用于校内身份验证，不存储）</li>
            <li><strong>问卷回答：</strong>35 道心理兼容性题目的答案（加密存储）</li>
            <li><strong>联系方式：</strong>微信/QQ 等联系方式（AES-256 加密存储）</li>
          </ul>

          <h3 className="font-bold text-gray-800 mt-4">二、信息的使用方式</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>计算您与其他用户的匹配度分数</li>
            <li>每周日自动执行匹配算法</li>
            <li>双方确认后交换加密的联系方式</li>
            <li>改进平台的匹配算法和服务质量</li>
          </ul>

          <h3 className="font-bold text-gray-800 mt-4">三、GPS 定位说明</h3>
          <p>注册时需要获取您的 GPS 位置以验证您是否在校内。此过程：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>仅在注册页面点击「验证位置」后触发</li>
            <li>坐标发送至服务器进行距离校验，校验完成后<strong>不保留原始坐标</strong></li>
            <li>仅记录验证结果（通过/未通过），不记录具体位置</li>
            <li>您可以随时拒绝授权，但将无法完成注册</li>
          </ul>

          <h3 className="font-bold text-gray-800 mt-4">四、信息分享</h3>
          <p><strong>我们不会出售您的个人信息。</strong></p>
          <p>以下情况除外：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>获得您的明确同意</li>
            <li>法律法规要求披露</li>
            <li>保护平台或其他用户的安全权益</li>
          </ul>

          <h3 className="font-bold text-gray-800 mt-4">五、联系我们</h3>
          <p>如有任何隐私相关疑问，请联系管理员。</p>
        </div>
        <a href="/" className="inline-block mt-8 text-pink-500 hover:underline">← 返回首页</a>
      </div>
    </div>
  )
}
