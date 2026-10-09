export type Breed = {
    id: string;
    name: string;
    life_span: string | null;
    temperament: string | null;
    origin: string | null;
    description: string | null;
    breed_group: string | null;

    weight: {
        imperical: string;
        metric: string;
    };

    height: {
        imperical: string;
        metric: string;
    };

    image?: {
        id: string;
        url: string;
        width: number;
        height: number;
    };
};