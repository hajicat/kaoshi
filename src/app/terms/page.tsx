export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-stone-50 p-8">
      <div className="max-w-2xl mx-auto glass-card rounded-3xl p-8">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">用户协议</h1>
        <div className="text-sm text-gray-600 space-y-4 leading-relaxed">
          <p><strong>生效日期：</strong>2026 年 1 月 1 日</p>

          <h3 className="font-bold text-gray-800 mt-4">一、服务说明</h3>
          <p>吉我爱</p>

          <h3 className="font-bold text-gray-800 mt-4">二、使用条件</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>您必须是上述长春高校的在校学生或教职工</li>
            <li>注册时需通过高校圈 GPS 定位验证</li>
            <li>每位用户仅可拥有一个账号</li>
            <li>您必须年满 16 周岁</li>
          </ul>

          <h3 className="font-bold text-gray-800 mt-4">三、用户行为规范</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>请如实填写问卷，虚假信息可能导致匹配结果不准确或账号被封禁</li>
            <li>尊重每一位参与者，禁止骚扰、谩骂、人身攻击等行为</li>
            <li>不得利用本平台从事任何违法活动</li>
            <li>保护他人隐私，不得泄露对方的联系方式或匹配信息</li>
          </ul>

          <h3 className="font-bold text-gray-800 mt-4">四、隐私与数据</h3>
          <p>我们承诺：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>不向任何第三方出售或共享您的个人信息</li>
            <li>GPS 位置仅用于高校圈验证，验证后不存储原始坐标</li>

            <li>联系方式仅在双方确认后交换</li>
            <li>您可以随时申请删除账号及所有关联数据</li>
          </ul>

          <h3 className="font-bold text-gray-800 mt-4">五、免责声明</h3>
          <p>本平台提供的匹配结果基于问卷算法计算，仅供参考。用户之间的线下交往需自行判断风险。平台不对用户间的线下行为承担法律责任。</p>

          <h3 className="font-bold text-gray-800 mt-4">六、协议修改</h3>
          <p>我们保留在必要时修改本协议的权利。重大变更将通过平台公告形式通知用户。</p>

          <h3 className="font-bold text-gray-800 mt-4">七、其他</h3>
          <p>吉我爱</p>
        </div>
        <a href="/" className="inline-block mt-8 text-pink-500 hover:underline">← 返回首页</a>
      </div>
    </div>
  )
}
