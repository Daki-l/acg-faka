<?php
declare(strict_types=1);

namespace App\Service\Bind;

use App\Model\Commodity;
use App\Model\Config as CFG;
use App\Model\Order;
use App\Model\Pay;
use App\Util\Currency;
use Kernel\Exception\JSONException;
use Kernel\Util\Decimal;

class OrderDeliveryEmailTemplate implements \App\Service\OrderDeliveryEmailTemplate
{
    private const CONFIG_KEY = 'order_delivery_email_template';
    private const DEFAULT_LOGO_URL = 'https://pub-50596955a81a4c48b14be13b50c9a58b.r2.dev/logo.png';
    private const DEFAULT_SUBJECT = '【发货提醒】Weiloo 小店订单已发货';
    private const PLACEHOLDER_PATTERN = '/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/';
    private const ENCODED_PLACEHOLDER_PATTERN = '/%7B%7B(?:%20|\s)*([a-z_][a-z0-9_]*)(?:%20|\s)*%7D%7D/i';

    private const PLACEHOLDERS = [
        'site_name' => '店铺名称',
        'logo_url' => 'Logo 地址',
        'order_no' => '订单号',
        'order_time' => '订单时间',
        'account' => '购买账号',
        'product_name' => '商品名称',
        'quantity' => '购买数量',
        'product_amount' => '商品金额',
        'service_fee' => '手续费',
        'total_amount' => '支付总额',
        'payment_method' => '支付方式',
        'delivery_content' => '发货内容',
    ];

    /** @return array{subject: string, html: string, logo_url: string, is_custom: bool} */
    public function getTemplate(): array
    {
        $default = $this->defaultTemplate();
        $raw = trim(CFG::get(self::CONFIG_KEY));
        if ($raw === '') {
            return $default;
        }

        $stored = json_decode($raw, true);
        if (!is_array($stored)) {
            return $default;
        }

        try {
            return $this->validateTemplate(
                (string)($stored['subject'] ?? ''),
                (string)($stored['html'] ?? ''),
                (string)($stored['logo_url'] ?? '')
            ) + ['is_custom' => true];
        } catch (\Throwable) {
            return $default;
        }
    }

    /** @return array<string, string> */
    public function placeholders(): array
    {
        return self::PLACEHOLDERS;
    }

    /** @return array{subject: string, html: string, logo_url: string, is_custom: bool} */
    public function save(string $subject, string $html, string $logoUrl): array
    {
        $template = $this->validateTemplate($subject, $html, $logoUrl);
        try {
            $encoded = json_encode($template, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new JSONException('邮件模板保存失败');
        }
        CFG::put(self::CONFIG_KEY, $encoded);
        return $template + ['is_custom' => true];
    }

    /** @return array{subject: string, html: string, logo_url: string, is_custom: bool} */
    public function restore(): array
    {
        CFG::put(self::CONFIG_KEY, '');
        return $this->defaultTemplate();
    }

    /** @return array{subject: string, html: string} */
    public function preview(string $subject, string $html, string $logoUrl): array
    {
        $template = $this->validateTemplate($subject, $html, $logoUrl);
        $values = $this->sampleValues();
        $values['logo_url'] = $template['logo_url'];
        return $this->renderTemplate($template, $values);
    }

    /** @return array{subject: string, html: string} */
    public function render(Order $order, ?Commodity $commodity = null, ?Pay $pay = null): array
    {
        $commodity ??= $order->commodity;
        $pay ??= $order->pay;
        $template = $this->getTemplate();

        $payCost = $this->numeric($order->pay_cost ?? 0);
        $totalAmount = $this->numeric($order->amount);
        $productAmount = (new Decimal($totalAmount, 2))->sub($payCost)->getAmount(2);
        $time = $this->string($order->pay_time) ?: $this->string($order->create_time);

        return $this->renderTemplate($template, [
            'site_name' => $this->siteName(),
            'logo_url' => $template['logo_url'],
            'order_no' => $this->string($order->trade_no),
            'order_time' => $this->formatTime($time),
            'account' => $this->string($order->contact),
            'product_name' => $commodity ? $this->string($commodity->name) : '商品信息未记录',
            'quantity' => (string)max(0, (int)$order->card_num),
            'product_amount' => $this->formatMoney($productAmount),
            'service_fee' => $this->formatMoney($payCost),
            'total_amount' => $this->formatMoney($totalAmount),
            'payment_method' => $pay ? $this->string($pay->name) : '支付方式未记录',
            'delivery_content' => $this->string($order->secret),
        ]);
    }

    /** @return array{subject: string, html: string, logo_url: string, is_custom: bool} */
    private function defaultTemplate(): array
    {
        return [
            'subject' => self::DEFAULT_SUBJECT,
            'html' => $this->defaultHtml(),
            'logo_url' => self::DEFAULT_LOGO_URL,
            'is_custom' => false,
        ];
    }

    private function defaultHtml(): string
    {
        $html = @file_get_contents(BASE_PATH . '/app/View/Mail/OrderDelivery.html');
        if (is_string($html) && trim($html) !== '') {
            return trim($html);
        }

        return '<!doctype html><html lang="zh-CN"><body><p>Weiloo 小店订单已发货。</p><p>订单号：{{order_no}}</p><p>{{delivery_content}}</p></body></html>';
    }

    /** @return array{subject: string, html: string, logo_url: string} */
    private function validateTemplate(string $subject, string $html, string $logoUrl): array
    {
        $subject = trim($this->normalizeEncodedPlaceholders($subject));
        $html = trim($this->normalizeEncodedPlaceholders($html));
        $logoUrl = trim($logoUrl);

        if ($subject === '' || $html === '' || $logoUrl === '') {
            throw new JSONException('邮件主题、HTML 模板和 Logo 地址不能为空');
        }
        if (strlen($subject) > 255 || strlen($html) > 60000 || strlen($logoUrl) > 2048) {
            throw new JSONException('邮件模板内容超出允许长度');
        }
        if (str_contains($subject, "\r") || str_contains($subject, "\n")) {
            throw new JSONException('邮件主题不能包含换行符');
        }

        $this->assertPlaceholders($subject, '邮件主题');
        $this->assertPlaceholders($html, 'HTML 模板');
        $this->assertHttpsUrl($logoUrl);

        return ['subject' => $subject, 'html' => $html, 'logo_url' => $logoUrl];
    }

    private function normalizeEncodedPlaceholders(string $value): string
    {
        return (string)preg_replace_callback(
            self::ENCODED_PLACEHOLDER_PATTERN,
            static fn(array $match): string => '{{' . $match[1] . '}}',
            $value
        );
    }

    private function assertPlaceholders(string $value, string $label): void
    {
        preg_match_all(self::PLACEHOLDER_PATTERN, $value, $matches);
        foreach ($matches[1] as $name) {
            if (!array_key_exists($name, self::PLACEHOLDERS)) {
                throw new JSONException($label . '包含不支持的占位符：{{' . $name . '}}');
            }
        }

        $remaining = preg_replace(self::PLACEHOLDER_PATTERN, '', $value);
        if (is_string($remaining) && (str_contains($remaining, '{{') || str_contains($remaining, '}}'))) {
            throw new JSONException($label . '存在格式不正确的占位符');
        }
    }

    private function assertHttpsUrl(string $url): void
    {
        if (preg_match('/[\x00-\x20\x7F]/', $url) === 1 || filter_var($url, FILTER_VALIDATE_URL) === false) {
            throw new JSONException('Logo 地址必须是有效的 HTTPS URL');
        }

        $parts = parse_url($url);
        if (!is_array($parts)
            || strtolower((string)($parts['scheme'] ?? '')) !== 'https'
            || !isset($parts['host'])
            || $parts['host'] === ''
            || array_key_exists('user', $parts)
            || array_key_exists('pass', $parts)) {
            throw new JSONException('Logo 地址仅支持不含账号密码的 HTTPS URL');
        }
    }

    /** @param array{subject: string, html: string, logo_url: string, is_custom?: bool} $template
     * @param array<string, string> $values
     * @return array{subject: string, html: string}
     */
    private function renderTemplate(array $template, array $values): array
    {
        $htmlValues = [];
        $subjectValues = [];
        foreach ($values as $key => $value) {
            $subjectValues[$key] = str_replace(["\r", "\n", "\0"], ' ', $value);
            $htmlValues[$key] = $key === 'delivery_content'
                ? nl2br($this->escape($value), false)
                : $this->escape($value);
        }

        $subject = $this->replace($template['subject'], $subjectValues);
        $subject = trim(str_replace(["\r", "\n", "\0"], ' ', $subject));
        return [
            'subject' => $subject,
            'html' => $this->replace($template['html'], $htmlValues),
        ];
    }

    /** @param array<string, string> $values */
    private function replace(string $template, array $values): string
    {
        return (string)preg_replace_callback(
            self::PLACEHOLDER_PATTERN,
            static fn(array $match): string => $values[$match[1]] ?? '',
            $template
        );
    }

    /** @return array<string, string> */
    private function sampleValues(): array
    {
        return [
            'site_name' => 'Weiloo 小店',
            'logo_url' => self::DEFAULT_LOGO_URL,
            'order_no' => 'TEST202609180001',
            'order_time' => '2026-09-18 12:00:00',
            'account' => 'demo@example.com',
            'product_name' => '示例商品',
            'quantity' => '1',
            'product_amount' => $this->formatMoney('98.00'),
            'service_fee' => $this->formatMoney('2.00'),
            'total_amount' => $this->formatMoney('100.00'),
            'payment_method' => '支付宝（示例）',
            'delivery_content' => "账号：demo@example.com\n密码：示例内容（测试邮件不包含真实卡密）",
        ];
    }

    private function siteName(): string
    {
        return $this->string(CFG::get('shop_name')) ?: 'Weiloo 小店';
    }

    private function formatMoney(string $amount): string
    {
        $amount = (new Decimal($this->numeric($amount), 2))->getAmount(Currency::decimals());
        return Currency::symbol() . ' ' . $amount;
    }

    private function formatTime(string $time): string
    {
        $timestamp = strtotime($time);
        return $timestamp === false ? $time : date('Y-m-d H:i:s', $timestamp);
    }

    private function numeric(mixed $value): string
    {
        $value = is_scalar($value) ? trim((string)$value) : '';
        return preg_match('/^-?\d+(?:\.\d+)?$/', $value) === 1 ? $value : '0';
    }

    private function string(mixed $value): string
    {
        return is_scalar($value) ? trim((string)$value) : '';
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
