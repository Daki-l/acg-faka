<?php
declare(strict_types=1);

namespace App\Service;

use App\Model\Commodity;
use App\Model\Order;
use App\Model\Pay;
use Kernel\Annotation\Bind;

#[Bind(class: \App\Service\Bind\OrderDeliveryEmailTemplate::class)]
interface OrderDeliveryEmailTemplate
{
    /** @return array{subject: string, html: string, logo_url: string, is_custom: bool} */
    public function getTemplate(): array;

    /** @return array<string, string> */
    public function placeholders(): array;

    /** @return array{subject: string, html: string, logo_url: string, is_custom: bool} */
    public function save(string $subject, string $html, string $logoUrl): array;

    /** @return array{subject: string, html: string, logo_url: string, is_custom: bool} */
    public function restore(): array;

    /** @return array{subject: string, html: string} */
    public function preview(string $subject, string $html, string $logoUrl): array;

    /** @return array{subject: string, html: string} */
    public function render(Order $order, ?Commodity $commodity = null, ?Pay $pay = null): array;
}
